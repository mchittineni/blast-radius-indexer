import { describe, expect, it } from 'vitest';
import { GitHubRepoSource } from '../src/github-source';
import { createFakeOctokit, HttpError } from './helpers/fake-octokit';

const repo = {
  owner: 'acme',
  name: 'core-ui-lib',
  fullName: 'acme/core-ui-lib',
  defaultBranch: 'main',
};

function makeSource(handlers: Parameters<typeof createFakeOctokit>[0]): {
  source: GitHubRepoSource;
  warnings: string[];
  calls: { endpoint: string }[];
} {
  const { octokit, calls } = createFakeOctokit(handlers);
  const warnings: string[] = [];
  const source = new GitHubRepoSource({
    octokit,
    org: 'acme',
    onWarning: (message) => warnings.push(message),
  });
  return { source, warnings, calls };
}

const base64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

describe('listRepos', () => {
  it('maps the org listing into repo descriptors', async () => {
    const { source } = makeSource({
      'repos.listForOrg': () => [
        { full_name: 'acme/core-ui-lib', default_branch: 'develop', archived: false, fork: false },
      ],
    });

    expect(await source.listRepos()).toEqual([
      {
        owner: 'acme',
        name: 'core-ui-lib',
        fullName: 'acme/core-ui-lib',
        defaultBranch: 'develop',
        archived: false,
        fork: false,
      },
    ]);
  });

  it('defaults a missing branch to main', async () => {
    const { source } = makeSource({ 'repos.listForOrg': () => [{ full_name: 'acme/x' }] });
    expect((await source.listRepos())[0]?.defaultBranch).toBe('main');
  });

  it('falls back to the user endpoint when the owner is not an organization', async () => {
    const { source, warnings, calls } = makeSource({
      'repos.listForOrg': () => {
        throw new HttpError(404);
      },
      'repos.listForUser': () => [{ full_name: 'acme/personal-repo' }],
    });

    expect((await source.listRepos())[0]?.fullName).toBe('acme/personal-repo');
    expect(calls.map((call) => call.endpoint)).toEqual(['repos.listForOrg', 'repos.listForUser']);
    expect(warnings.join(' ')).toContain('not an organization');
  });

  it('rethrows errors that are not an account-type mismatch', async () => {
    const { source } = makeSource({
      'repos.listForOrg': () => {
        throw new HttpError(401, 'Bad credentials');
      },
    });
    await expect(source.listRepos()).rejects.toThrow('Bad credentials');
  });
});

describe('listFiles', () => {
  it('returns blob paths from a single recursive tree call', async () => {
    const { source } = makeSource({
      'git.getTree': () => ({
        data: {
          truncated: false,
          tree: [
            { type: 'blob', path: 'package.json' },
            { type: 'tree', path: 'src' },
            { type: 'blob', path: 'src/index.ts' },
          ],
        },
      }),
    });

    expect(await source.listFiles(repo)).toEqual(['package.json', 'src/index.ts']);
  });

  it('caches the tree so repeated scans do not re-request it', async () => {
    const { source, calls } = makeSource({
      'git.getTree': () => ({ data: { truncated: false, tree: [] } }),
    });

    await source.listFiles(repo);
    await source.listFiles(repo);
    expect(calls.filter((call) => call.endpoint === 'git.getTree')).toHaveLength(1);
  });

  it('warns when the API truncates the tree, so gaps are not silent', async () => {
    const { source, warnings } = makeSource({
      'git.getTree': () => ({ data: { truncated: true, tree: [] } }),
    });

    await source.listFiles(repo);
    expect(warnings.join(' ')).toContain('truncated');
  });

  it('treats an empty repository as having no files', async () => {
    const { source } = makeSource({
      'git.getTree': () => {
        throw new HttpError(409);
      },
    });
    expect(await source.listFiles(repo)).toEqual([]);
  });

  it('surfaces other tree failures to the scanner', async () => {
    const { source } = makeSource({
      'git.getTree': () => {
        throw new HttpError(500, 'server error');
      },
    });
    await expect(source.listFiles(repo)).rejects.toThrow(/failed to list files/);
  });
});

describe('readFile', () => {
  it('decodes base64 file content', async () => {
    const { source } = makeSource({
      'repos.getContent': () => ({
        data: { type: 'file', size: 20, content: base64('{"name":"x"}') },
      }),
    });
    expect(await source.readFile(repo, 'package.json')).toBe('{"name":"x"}');
  });

  it('returns null for a directory response', async () => {
    const { source } = makeSource({ 'repos.getContent': () => ({ data: [] }) });
    expect(await source.readFile(repo, 'src')).toBeNull();
  });

  it('skips blobs above the API base64 ceiling with a warning', async () => {
    const { source, warnings } = makeSource({
      'repos.getContent': () => ({ data: { type: 'file', size: 5_000_000, content: 'x' } }),
    });

    expect(await source.readFile(repo, 'huge.json')).toBeNull();
    expect(warnings.join(' ')).toContain('exceeds');
  });

  it('returns null for a missing file without warning', async () => {
    const { source, warnings } = makeSource({
      'repos.getContent': () => {
        throw new HttpError(404);
      },
    });

    expect(await source.readFile(repo, 'nope.json')).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('degrades to null with a warning on other read failures', async () => {
    const { source, warnings } = makeSource({
      'repos.getContent': () => {
        throw new HttpError(403, 'rate limited');
      },
    });

    expect(await source.readFile(repo, 'package.json')).toBeNull();
    expect(warnings.join(' ')).toContain('rate limited');
  });

  it('returns null for an empty content payload', async () => {
    const { source } = makeSource({
      'repos.getContent': () => ({ data: { type: 'file', size: 0, content: '' } }),
    });
    expect(await source.readFile(repo, 'empty.json')).toBeNull();
  });
});
