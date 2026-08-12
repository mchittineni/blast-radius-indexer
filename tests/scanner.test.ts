/**
 * Resilience and source-selection behavior that the fixture-directory e2e test
 * cannot reach: a repository that fails mid-scan, and the GitHub API path.
 */
import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { runIndexer } from '../src/index';
import { scanRepositories } from '../src/scanner';
import { GitHubRepoSource } from '../src/github-source';
import { LocalDirectoryRepoSource } from '../src/local-source';
import type { RepoDescriptor, RepoSource } from '../src/source';
import { createFakeOctokit } from './helpers/fake-octokit';

const repo = (name: string): RepoDescriptor => ({
  owner: 'acme',
  name,
  fullName: `acme/${name}`,
  defaultBranch: 'main',
});

/** A source where a named repository throws when its files are listed. */
function failingSource(failOn: string): RepoSource {
  return {
    host: 'github.com',
    listRepos: async () => [repo('healthy'), repo(failOn)],
    listFiles: async (target) => {
      if (target.name === failOn) throw new Error('403 rate limited');
      return ['package.json'];
    },
    readFile: async () => JSON.stringify({ name: '@acme/healthy', version: '1.0.0' }),
  };
}

describe('scanRepositories resilience', () => {
  it('records a warning and keeps going when one repository fails', async () => {
    const result = await scanRepositories(failingSource('broken'), { org: 'acme' });

    // The healthy repository must still be indexed — one bad repo cannot void a nightly run.
    expect(result.repos.map((entry) => entry.repo)).toEqual(['acme/healthy']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Skipped acme/broken');
    expect(result.warnings[0]).toContain('403 rate limited');
  });

  it('excludes archived and forked repositories unless asked for them', async () => {
    const source: RepoSource = {
      host: 'github.com',
      listRepos: async () => [
        { ...repo('active') },
        { ...repo('old'), archived: true },
        { ...repo('copy'), fork: true },
      ],
      listFiles: async () => [],
      readFile: async () => null,
    };

    const excluded = await scanRepositories(source, { org: 'acme' });
    expect(excluded.repos.map((entry) => entry.repo)).toEqual(['acme/active']);

    const included = await scanRepositories(source, {
      org: 'acme',
      includeArchived: true,
      includeForks: true,
    });
    expect(included.repos).toHaveLength(3);
  });

  it('reports progress for the caller to log', async () => {
    const messages: string[] = [];
    await scanRepositories(failingSource('broken'), {
      org: 'acme',
      onProgress: (message) => messages.push(message),
    });
    expect(messages.join('\n')).toContain('Scanning 2 of 2 repositories');
  });
});

describe('runIndexer source selection', () => {
  it('indexes through the GitHub API when no local path is given', async () => {
    const { octokit } = createFakeOctokit({
      'repos.listForOrg': () => [{ full_name: 'acme/lib', default_branch: 'main' }],
      'git.getTree': () => ({
        data: { truncated: false, tree: [{ type: 'blob', path: 'package.json' }] },
      }),
      'repos.getContent': () => ({
        data: {
          type: 'file',
          size: 40,
          content: Buffer.from(JSON.stringify({ name: '@acme/lib', version: '1.0.0' })).toString(
            'base64',
          ),
        },
      }),
    });

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'blast-radius-api-'));
    try {
      const outputPath = path.join(workspace, 'graph.json');
      const outcome = await runIndexer({
        org: 'acme',
        outputPath,
        octokit,
        generatedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(outcome.stats.repoCount).toBe(1);
      expect(outcome.graph.artifacts['npm:@acme/lib']?.publisherRepo).toBe('acme/lib');
      await expect(fs.readFile(outputPath, 'utf8')).resolves.toContain('@acme/lib');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('prefers the local path over an available client', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'blast-radius-local-'));
    try {
      await fs.mkdir(path.join(workspace, 'org/lib'), { recursive: true });
      await fs.writeFile(
        path.join(workspace, 'org/lib/package.json'),
        JSON.stringify({ name: '@acme/local' }),
      );

      const { octokit, calls } = createFakeOctokit({
        'repos.listForOrg': () => {
          throw new Error('the API must not be called when local-path is set');
        },
      });

      const outcome = await runIndexer({
        org: 'acme',
        outputPath: path.join(workspace, 'graph.json'),
        localPath: path.join(workspace, 'org'),
        octokit,
        generatedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(outcome.graph.artifacts['npm:@acme/local']).toBeDefined();
      expect(calls).toHaveLength(0);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('LocalDirectoryRepoSource', () => {
  it('returns null for a file that does not exist', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'blast-radius-missing-'));
    try {
      await fs.mkdir(path.join(workspace, 'lib'), { recursive: true });
      const source = new LocalDirectoryRepoSource(workspace, 'acme');
      expect(await source.readFile(repo('lib'), 'package.json')).toBeNull();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('GitHubRepoSource host', () => {
  it('defaults to github.com so Terraform identities canonicalize consistently', () => {
    const { octokit } = createFakeOctokit({ 'repos.listForOrg': () => [] });
    expect(new GitHubRepoSource({ octokit, org: 'acme' }).host).toBe('github.com');
  });
});
