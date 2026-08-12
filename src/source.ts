/**
 * The scanner reads repositories through this interface so the indexing logic
 * can be exercised against a local fixture directory without touching the
 * network, and so a future source (GitLab, a local org mirror) is a drop-in.
 */

export interface RepoDescriptor {
  owner: string;
  name: string;
  /** `owner/name`. */
  fullName: string;
  defaultBranch: string;
  archived?: boolean;
  fork?: boolean;
}

export interface RepoSource {
  /** Git host used to canonicalize Terraform module identities. */
  readonly host: string;
  listRepos(): Promise<RepoDescriptor[]>;
  /** Every repo-relative file path on the default branch. */
  listFiles(repo: RepoDescriptor): Promise<string[]>;
  /** File contents as UTF-8, or `null` when unreadable (too large, binary, gone). */
  readFile(repo: RepoDescriptor, filePath: string): Promise<string | null>;
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Scanning an org means thousands of API calls; unbounded `Promise.all` both
 * trips secondary rate limits and holds every response in memory at once.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<TResult>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}
