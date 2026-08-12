import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GitHub } from '@actions/github/lib/utils';
import type { GraphIndex } from './types';
import { buildGraph, summarizeGraph, type GraphStats } from './graph';
import { GitHubRepoSource } from './github-source';
import { LocalDirectoryRepoSource } from './local-source';
import { scanRepositories, type ScanOptions } from './scanner';
import type { RepoSource } from './source';

export interface IndexerOptions extends ScanOptions {
  /** Where `graph.json` is written. */
  outputPath: string;
  /** Authenticated client. Omit only when `localPath` is set. */
  octokit?: InstanceType<typeof GitHub> | undefined;
  /** Scan a directory of repositories instead of the GitHub API. */
  localPath?: string | undefined;
  /** Overridden in tests so snapshots stay stable. */
  generatedAt?: string | undefined;
}

export interface IndexerOutcome {
  graph: GraphIndex;
  stats: GraphStats;
  warnings: string[];
  outputPath: string;
}

/**
 * Build the dependency graph for an org and write it to disk.
 *
 * Source selection is explicit: `localPath` wins when set (dry runs and tests),
 * otherwise an authenticated `octokit` is required. The previous behaviour —
 * silently producing an empty graph when no local path existed — hid
 * misconfiguration behind a green check.
 */
export async function runIndexer(options: IndexerOptions): Promise<IndexerOutcome> {
  const source = resolveSource(options);

  const scan = await scanRepositories(source, options);
  const graph = buildGraph({
    org: options.org,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    repos: scan.repos,
    warnings: scan.warnings,
  });

  await writeGraph(options.outputPath, graph);

  return {
    graph,
    stats: summarizeGraph(graph),
    warnings: scan.warnings,
    outputPath: options.outputPath,
  };
}

function resolveSource(options: IndexerOptions): RepoSource {
  if (options.localPath !== undefined && options.localPath !== '') {
    return new LocalDirectoryRepoSource(options.localPath, options.org);
  }
  if (options.octokit === undefined) {
    throw new Error(
      'No repository source available: provide a GitHub token, or set `local-path` to scan a directory.',
    );
  }
  return new GitHubRepoSource({
    octokit: options.octokit,
    org: options.org,
    onWarning: options.onProgress,
  });
}

async function writeGraph(outputPath: string, graph: GraphIndex): Promise<void> {
  const outputDir = path.dirname(path.resolve(outputPath));
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
}
