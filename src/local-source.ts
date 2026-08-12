import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isIgnoredPath } from '../shared/normalize';
import type { RepoDescriptor, RepoSource } from './source';

/** Cap on directory entries walked per repo, so a symlink cycle cannot hang the run. */
const MAX_WALK_ENTRIES = 20_000;

/**
 * Treats each immediate sub-directory of `rootPath` as one repository.
 *
 * This is the fixture-driven counterpart to {@link GitHubRepoSource}: it makes
 * the whole indexing pipeline testable and lets `local-path` dry-run the action
 * against a checkout without burning API quota.
 */
export class LocalDirectoryRepoSource implements RepoSource {
  public readonly host: string;

  private readonly rootPath: string;
  private readonly owner: string;

  public constructor(rootPath: string, owner: string, host = 'github.com') {
    this.rootPath = rootPath;
    this.owner = owner;
    this.host = host;
  }

  public async listRepos(): Promise<RepoDescriptor[]> {
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({
        owner: this.owner,
        name: entry.name,
        fullName: `${this.owner}/${entry.name}`,
        defaultBranch: 'main',
        archived: false,
        fork: false,
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  public async listFiles(repo: RepoDescriptor): Promise<string[]> {
    const repoRoot = path.join(this.rootPath, repo.name);
    const found: string[] = [];
    let budget = MAX_WALK_ENTRIES;

    const walk = async (currentDir: string, relativeDir: string): Promise<void> => {
      if (budget <= 0) return;

      // `withFileTypes` avoids a stat() per entry, and symlinks stay unfollowed.
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (budget-- <= 0) return;

        const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
        if (isIgnoredPath(relativePath)) continue;

        if (entry.isDirectory()) {
          await walk(path.join(currentDir, entry.name), relativePath);
        } else if (entry.isFile()) {
          found.push(relativePath);
        }
      }
    };

    await walk(repoRoot, '');
    return found;
  }

  public async readFile(repo: RepoDescriptor, filePath: string): Promise<string | null> {
    // Reject traversal: a fixture path must stay inside its own repo directory.
    const repoRoot = path.resolve(this.rootPath, repo.name);
    const resolved = path.resolve(repoRoot, filePath);
    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) return null;

    try {
      return await fs.readFile(resolved, 'utf8');
    } catch {
      return null;
    }
  }
}
