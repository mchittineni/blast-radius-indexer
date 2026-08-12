/**
 * End-to-end coverage for the indexing pipeline: a fixture org on disk is
 * scanned and a `graph.json` is written.
 *
 * The consuming side of the contract lives in `blast-radius-check`; here we
 * assert only that the graph written to disk is well-formed and complete.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIndexer } from '../src/index';
import { LocalDirectoryRepoSource } from '../src/local-source';
import { scanRepositories } from '../src/scanner';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

let workspace: string;

async function writeFixture(repo: string, filePath: string, content: string): Promise<void> {
  const target = path.join(workspace, 'org', repo, filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'blast-radius-'));

  // A library that publishes an npm package.
  await writeFixture(
    'core-ui-lib',
    'package.json',
    JSON.stringify({ name: '@acme/core-ui', version: '2.1.0' }, null, 2),
  );

  // A base-image repo that publishes a container image.
  await writeFixture('base-images', 'Dockerfile', 'FROM node:22-alpine\nWORKDIR /app\n');

  // A Terraform module repo.
  await writeFixture('tf-vpc', 'main.tf', 'variable "cidr" {}\n');

  // An app consuming all three.
  await writeFixture(
    'user-portal-app',
    'package.json',
    JSON.stringify(
      { name: '@acme/user-portal', private: true, dependencies: { '@acme/core-ui': '^2.0.0' } },
      null,
      2,
    ),
  );
  await writeFixture('user-portal-app', 'Dockerfile', 'FROM ghcr.io/acme/base-images:18\n');
  await writeFixture(
    'user-portal-app',
    'infra/main.tf',
    'module "vpc" {\n  source = "git::https://github.com/acme/tf-vpc.git?ref=v1.0.0"\n}\n',
  );

  // Noise that must never be indexed.
  await writeFixture(
    'user-portal-app',
    'node_modules/react/package.json',
    JSON.stringify({ name: 'react', version: '18.0.0' }),
  );
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('indexer end to end', () => {
  it('writes a graph linking every supported artifact type', async () => {
    const outputPath = path.join(workspace, 'out', 'graph.json');
    const outcome = await runIndexer({
      org: 'acme',
      outputPath,
      localPath: path.join(workspace, 'org'),
      generatedAt: GENERATED_AT,
    });

    expect(outcome.stats.repoCount).toBe(4);
    expect(outcome.graph.artifacts['npm:@acme/core-ui']?.consumers).toMatchObject([
      { repo: 'acme/user-portal-app', sourceFile: 'package.json' },
    ]);
    expect(outcome.graph.artifacts['docker:acme/base-images']?.consumers).toMatchObject([
      { repo: 'acme/user-portal-app', sourceFile: 'Dockerfile' },
    ]);
    expect(outcome.graph.artifacts['terraform:github.com/acme/tf-vpc']?.consumers).toMatchObject([
      { repo: 'acme/user-portal-app', sourceFile: 'infra/main.tf' },
    ]);

    // The file on disk must be exactly what the checker will read back.
    const written: unknown = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    expect(written).toEqual(JSON.parse(JSON.stringify(outcome.graph)));
  });

  it('never indexes vendored trees', async () => {
    const outcome = await runIndexer({
      org: 'acme',
      outputPath: path.join(workspace, 'out', 'graph.json'),
      localPath: path.join(workspace, 'org'),
      generatedAt: GENERATED_AT,
    });
    expect(outcome.graph.artifacts['npm:react']).toBeUndefined();
  });

  it('does not treat a private app manifest as a published artifact', async () => {
    const outcome = await runIndexer({
      org: 'acme',
      outputPath: path.join(workspace, 'out', 'graph.json'),
      localPath: path.join(workspace, 'org'),
      generatedAt: GENERATED_AT,
    });
    expect(outcome.graph.artifacts['npm:@acme/user-portal']).toBeUndefined();
  });

  it('fails loudly when no repository source is configured', async () => {
    await expect(
      runIndexer({ org: 'acme', outputPath: path.join(workspace, 'out', 'graph.json') }),
    ).rejects.toThrow(/No repository source available/);
  });

  it('applies the repo filter as a substring and as a regex', async () => {
    const source = new LocalDirectoryRepoSource(path.join(workspace, 'org'), 'acme');

    const substring = await scanRepositories(source, { org: 'acme', repoFilter: 'portal' });
    expect(substring.repos.map((repo) => repo.repo)).toEqual(['acme/user-portal-app']);

    const regex = await scanRepositories(source, { org: 'acme', repoFilter: '/^acme\\/tf-/' });
    expect(regex.repos.map((repo) => repo.repo)).toEqual(['acme/tf-vpc']);
  });

  it('warns rather than silently truncating when a repo exceeds the file cap', async () => {
    const source = new LocalDirectoryRepoSource(path.join(workspace, 'org'), 'acme');
    const scan = await scanRepositories(source, {
      org: 'acme',
      repoFilter: 'user-portal-app',
      maxFilesPerRepo: 1,
    });
    expect(scan.warnings.join(' ')).toContain('exceed max-files-per-repo');
  });

  it('refuses to read outside a repository directory', async () => {
    const source = new LocalDirectoryRepoSource(path.join(workspace, 'org'), 'acme');
    const repos = await source.listRepos();
    const repo = repos.find((entry) => entry.name === 'core-ui-lib');
    expect(repo).toBeDefined();
    expect(await source.readFile(repo!, '../base-images/Dockerfile')).toBeNull();
  });
});
