/**
 * Canonicalization helpers.
 *
 * Matching a consumer reference to a publisher declaration only works if both
 * sides are reduced to the same string first. A raw Terraform `source =` value
 * (`git::https://github.com/acme/tf-vpc.git//modules/x?ref=v1.2.0`) and a raw
 * Docker image ref (`ghcr.io/acme/base:18`) never match a publisher name
 * verbatim, so every parser routes through this module.
 */

/** Normalize a repo-relative path: strip `./`, collapse `\` to `/`, drop leading `/`. */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

const IGNORED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.terraform',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '__fixtures__',
  'fixtures',
  'testdata',
]);

/** True when a path lives under a directory we never want to index. */
export function isIgnoredPath(filePath: string): boolean {
  return normalizePath(filePath)
    .split('/')
    .some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

export interface DockerImageRef {
  /** Canonical name without tag or digest, e.g. `acme/base-node`. */
  name: string;
  tag?: string | undefined;
  digest?: string | undefined;
}

/**
 * Parse a Docker image reference into a canonical name plus tag/digest.
 *
 * Docker Hub prefixes are dropped so `docker.io/acme/x`, `index.docker.io/acme/x`
 * and `acme/x` all reduce to `acme/x`. Other registries keep their host, because
 * `ghcr.io/acme/x` and `quay.io/acme/x` are genuinely different images.
 *
 * Returns `null` for references we cannot resolve statically (`scratch`, or
 * unexpanded `ARG`/`ENV` interpolation).
 */
export function parseDockerImageRef(rawRef: string): DockerImageRef | null {
  const ref = rawRef.trim();
  if (ref === '' || ref === 'scratch') return null;
  // `FROM ${BASE_IMAGE}` / `FROM $BASE` cannot be resolved without build args.
  if (ref.includes('$')) return null;

  let remainder = ref;
  let digest: string | undefined;
  const digestSplit = remainder.split('@');
  if (digestSplit.length === 2 && digestSplit[0] !== undefined && digestSplit[1] !== undefined) {
    remainder = digestSplit[0];
    digest = digestSplit[1];
  }

  let tag: string | undefined;
  // A colon before the first `/` is a registry port, not a tag: `localhost:5000/img`.
  const lastColon = remainder.lastIndexOf(':');
  const lastSlash = remainder.lastIndexOf('/');
  if (lastColon > lastSlash) {
    tag = remainder.slice(lastColon + 1);
    remainder = remainder.slice(0, lastColon);
  }

  let name = remainder.replace(/^(index\.)?docker\.io\//, '');
  if (name.startsWith('library/')) name = name.slice('library/'.length);
  if (name === '') return null;

  return { name: name.toLowerCase(), tag, digest };
}

/** Every name a container image published by `owner/repo` may be referenced by. */
export function dockerImageAliases(owner: string, repo: string): string[] {
  const lowerOwner = owner.toLowerCase();
  const lowerRepo = repo.toLowerCase();
  return [`${lowerOwner}/${lowerRepo}`, `ghcr.io/${lowerOwner}/${lowerRepo}`];
}

export interface TerraformSourceRef {
  /** Canonical name, e.g. `github.com/acme/tf-vpc`, or the raw value if unresolvable. */
  name: string;
  /** Sub-directory after `//`, if any. */
  subdir?: string | undefined;
  /** `?ref=` value, if any. */
  ref?: string | undefined;
  /** False for local paths (`./modules/x`) which are never cross-repo. */
  isRemote: boolean;
}

/**
 * Canonicalize a Terraform module `source` value to `<host>/<owner>/<repo>`.
 *
 * Handles the `git::`, `github.com/`, SSH, and generic-git forms documented at
 * https://developer.hashicorp.com/terraform/language/modules/sources.
 */
export function parseTerraformSource(rawSource: string): TerraformSourceRef {
  const source = rawSource.trim();

  // Local paths are in-repo, never cross-repo.
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
    return { name: source, isRemote: false };
  }

  let remainder = source.replace(/^git::/, '');

  let ref: string | undefined;
  const queryIndex = remainder.indexOf('?');
  if (queryIndex !== -1) {
    const query = remainder.slice(queryIndex + 1);
    remainder = remainder.slice(0, queryIndex);
    const refMatch = query.match(/(?:^|&)(?:ref|rev)=([^&]+)/);
    if (refMatch?.[1] !== undefined) ref = decodeURIComponent(refMatch[1]);
  }

  // Strip the scheme, including the `git@` SSH userinfo.
  remainder = remainder.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/^git@/, '');
  // SSH shorthand `github.com:acme/repo.git` → `github.com/acme/repo.git`.
  remainder = remainder.replace(/^([^/]+):(?!\d)/, '$1/');

  let subdir: string | undefined;
  const subdirIndex = remainder.indexOf('//');
  if (subdirIndex !== -1) {
    subdir = remainder.slice(subdirIndex + 2);
    remainder = remainder.slice(0, subdirIndex);
  }

  remainder = remainder.replace(/\.git$/, '').replace(/\/+$/, '');

  const segments = remainder.split('/').filter((segment) => segment !== '');
  const looksLikeHost = segments[0]?.includes('.') ?? false;

  // Keep only host/owner/repo — deeper paths belong to the subdir, not the identity.
  const name = looksLikeHost ? segments.slice(0, 3).join('/') : segments.slice(0, 2).join('/');

  return {
    name: name === '' ? source : name.toLowerCase(),
    subdir,
    ref,
    isRemote: true,
  };
}

/** Every source string a Terraform module published by `owner/repo` may be referenced by. */
export function terraformModuleAliases(host: string, owner: string, repo: string): string[] {
  return [`${host}/${owner}/${repo}`.toLowerCase(), `${owner}/${repo}`.toLowerCase()];
}
