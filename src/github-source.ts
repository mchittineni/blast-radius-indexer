import type { GitHub } from '@actions/github/lib/utils';
import type { RepoDescriptor, RepoSource } from './source';

type Octokit = InstanceType<typeof GitHub>;

/** GitHub's REST API refuses to return blobs above 1 MiB as base64. */
const MAX_BLOB_BYTES = 1024 * 1024;

interface GitHubSourceOptions {
  octokit: Octokit;
  org: string;
  host?: string;
  onWarning?: ((message: string) => void) | undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * Reads an organization's repositories over the GitHub REST API.
 *
 * File discovery uses one recursive tree request per repository rather than
 * walking `getContent` directory by directory: a single call finds nested
 * manifests (monorepo `packages/*​/package.json`, `infra/*.tf`) at a fixed API
 * cost instead of one call per directory.
 */
export class GitHubRepoSource implements RepoSource {
  public readonly host: string;

  private readonly octokit: Octokit;
  private readonly org: string;
  private readonly warn: (message: string) => void;
  private readonly treeCache = new Map<string, string[]>();

  public constructor(options: GitHubSourceOptions) {
    this.octokit = options.octokit;
    this.org = options.org;
    this.host = options.host ?? 'github.com';
    this.warn = options.onWarning ?? ((): void => undefined);
  }

  public async listRepos(): Promise<RepoDescriptor[]> {
    const raw = await this.fetchRepoList();
    return raw.map((repo) => {
      const [owner, name] = splitFullName(repo.full_name, this.org);
      return {
        owner,
        name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? 'main',
        archived: repo.archived ?? false,
        fork: repo.fork ?? false,
      };
    });
  }

  /**
   * An owner may be an organization or a user, and the caller usually does not
   * know which. Try the org endpoint first and fall back on 403/404 rather than
   * making the caller declare the account type.
   */
  private async fetchRepoList(): Promise<ListedRepo[]> {
    try {
      return await this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
        org: this.org,
        type: 'all',
        per_page: 100,
      });
    } catch (error) {
      const status = statusOf(error);
      if (status !== 403 && status !== 404) throw error;
      this.warn(`${this.org} is not an organization (HTTP ${String(status)}); listing user repos.`);
      return await this.octokit.paginate(this.octokit.rest.repos.listForUser, {
        username: this.org,
        type: 'all',
        per_page: 100,
      });
    }
  }

  public async listFiles(repo: RepoDescriptor): Promise<string[]> {
    const cached = this.treeCache.get(repo.fullName);
    if (cached !== undefined) return cached;

    try {
      const response = await this.octokit.rest.git.getTree({
        owner: repo.owner,
        repo: repo.name,
        tree_sha: repo.defaultBranch,
        recursive: 'true',
      });

      if (response.data.truncated) {
        this.warn(
          `${repo.fullName}: git tree was truncated by the API; deeply nested manifests may be missing.`,
        );
      }

      const paths = response.data.tree
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path);

      this.treeCache.set(repo.fullName, paths);
      return paths;
    } catch (error) {
      const status = statusOf(error);
      // 409 is GitHub's response for an empty repository — not an error worth surfacing.
      if (status === 409) return [];
      throw new Error(`failed to list files: ${describeError(error)}`);
    }
  }

  public async readFile(repo: RepoDescriptor, filePath: string): Promise<string | null> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.name,
        path: filePath,
        ref: repo.defaultBranch,
      });

      const data = response.data;
      if (Array.isArray(data) || data.type !== 'file') return null;
      if (data.size > MAX_BLOB_BYTES) {
        this.warn(
          `${repo.fullName}/${filePath}: skipped, exceeds ${String(MAX_BLOB_BYTES)} bytes.`,
        );
        return null;
      }
      if (typeof data.content !== 'string' || data.content === '') return null;

      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      const status = statusOf(error);
      if (status === 404) return null;
      this.warn(`${repo.fullName}/${filePath}: ${describeError(error)}`);
      return null;
    }
  }
}

interface ListedRepo {
  full_name: string;
  default_branch?: string | undefined;
  archived?: boolean | undefined;
  fork?: boolean | undefined;
}

function splitFullName(fullName: string, fallbackOwner: string): [string, string] {
  const separator = fullName.indexOf('/');
  if (separator === -1) return [fallbackOwner, fullName];
  return [fullName.slice(0, separator), fullName.slice(separator + 1)];
}
