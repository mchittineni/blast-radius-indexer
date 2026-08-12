import { isIgnoredPath, normalizePath } from '../shared/normalize';
import type { RepositoryIndex } from '../shared/types';
import { isIndexableFile, parseFile } from './parsers';
import { mapWithConcurrency, type RepoDescriptor, type RepoSource } from './source';

export interface ScanOptions {
  org: string;
  includeArchived?: boolean;
  includeForks?: boolean;
  /** Case-insensitive substring or `/regex/` applied to `owner/name`. */
  repoFilter?: string | undefined;
  /** Hard cap on indexable files read per repository. */
  maxFilesPerRepo?: number;
  /** Repositories scanned in parallel. */
  concurrency?: number;
  /** Files read in parallel within one repository. */
  fileConcurrency?: number;
  onProgress?: ((message: string) => void) | undefined;
}

export interface ScanResult {
  repos: RepositoryIndex[];
  warnings: string[];
}

const DEFAULTS = {
  maxFilesPerRepo: 200,
  concurrency: 8,
  fileConcurrency: 8,
} as const;

function buildRepoFilter(pattern: string | undefined): (fullName: string) => boolean {
  if (pattern === undefined || pattern.trim() === '') return () => true;

  const trimmed = pattern.trim();
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch?.[1] !== undefined) {
    const regex = new RegExp(regexMatch[1], regexMatch[2] ?? '');
    return (fullName) => regex.test(fullName);
  }

  const needle = trimmed.toLowerCase();
  return (fullName) => fullName.toLowerCase().includes(needle);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a per-repository index from a {@link RepoSource}.
 *
 * A repository that fails to scan produces a warning rather than aborting the
 * run: a partial index that names its own gaps is more useful than no index,
 * and a single archived-but-unreadable repo should not break the nightly job.
 */
export async function scanRepositories(
  source: RepoSource,
  options: ScanOptions,
): Promise<ScanResult> {
  const maxFilesPerRepo = options.maxFilesPerRepo ?? DEFAULTS.maxFilesPerRepo;
  const concurrency = options.concurrency ?? DEFAULTS.concurrency;
  const fileConcurrency = options.fileConcurrency ?? DEFAULTS.fileConcurrency;
  const report = options.onProgress ?? ((): void => undefined);
  const warnings: string[] = [];

  const allRepos = await source.listRepos();
  const matchesFilter = buildRepoFilter(options.repoFilter);

  const targets = allRepos.filter((repo) => {
    if (repo.archived === true && options.includeArchived !== true) return false;
    if (repo.fork === true && options.includeForks !== true) return false;
    return matchesFilter(repo.fullName);
  });

  report(`Scanning ${String(targets.length)} of ${String(allRepos.length)} repositories`);

  const indexed = await mapWithConcurrency(targets, concurrency, async (repo) => {
    try {
      return await scanOneRepository(source, repo, {
        maxFilesPerRepo,
        fileConcurrency,
        warnings,
        report,
      });
    } catch (error) {
      warnings.push(`Skipped ${repo.fullName}: ${describeError(error)}`);
      return null;
    }
  });

  return {
    repos: indexed.filter((entry): entry is RepositoryIndex => entry !== null),
    warnings,
  };
}

interface RepoScanContext {
  maxFilesPerRepo: number;
  fileConcurrency: number;
  warnings: string[];
  report: (message: string) => void;
}

async function scanOneRepository(
  source: RepoSource,
  repo: RepoDescriptor,
  context: RepoScanContext,
): Promise<RepositoryIndex> {
  const index: RepositoryIndex = {
    repo: repo.fullName,
    defaultBranch: repo.defaultBranch,
    exports: [],
    imports: [],
  };

  const allPaths = await source.listFiles(repo);
  const candidates = allPaths
    .map(normalizePath)
    .filter((filePath) => !isIgnoredPath(filePath) && isIndexableFile(filePath))
    .sort(
      (left, right) =>
        left.split('/').length - right.split('/').length || left.localeCompare(right),
    );

  if (candidates.length > context.maxFilesPerRepo) {
    context.warnings.push(
      `${repo.fullName}: ${String(candidates.length)} indexable files exceed max-files-per-repo ` +
        `(${String(context.maxFilesPerRepo)}); indexed the shallowest ${String(context.maxFilesPerRepo)}.`,
    );
  }
  const selected = candidates.slice(0, context.maxFilesPerRepo);
  if (selected.length === 0) return index;

  const parsed = await mapWithConcurrency(selected, context.fileConcurrency, async (filePath) => {
    const content = await source.readFile(repo, filePath);
    if (content === null) return null;
    return parseFile(content, {
      owner: repo.owner,
      repoName: repo.name,
      filePath,
      host: source.host,
    });
  });

  // Derived exports (a docker image, a root Terraform module) are emitted once per
  // matching file, so `Dockerfile` + `Dockerfile.dev` or `main.tf` + `variables.tf`
  // would otherwise repeat the same declaration. Keep the first spelling only.
  const seenExports = new Set<string>();
  for (const result of parsed) {
    if (result === null) continue;

    for (const declaration of result.exports) {
      const key = `${declaration.type}:${declaration.name}`;
      if (seenExports.has(key)) continue;
      seenExports.add(key);
      index.exports.push(declaration);
    }

    for (const consumer of result.imports) {
      index.imports.push({ ...consumer, repo: repo.fullName });
    }
  }

  context.report(
    `${repo.fullName}: ${String(index.exports.length)} exports, ${String(index.imports.length)} imports`,
  );
  return index;
}
