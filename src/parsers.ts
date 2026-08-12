import type { ArtifactConsumer, ArtifactDeclaration } from '../shared/types';
import {
  dockerImageAliases,
  normalizePath,
  parseDockerImageRef,
  parseTerraformSource,
  terraformModuleAliases,
} from '../shared/normalize';

/** What a single file contributed to the index. */
export interface ParseResult {
  exports: ArtifactDeclaration[];
  imports: ArtifactConsumer[];
}

export interface ParseContext {
  /** Organization or user that owns the repository being parsed. */
  owner: string;
  /** Repository name without the owner. */
  repoName: string;
  /** Repo-relative path of the file being parsed. */
  filePath: string;
  /** Git host, used to canonicalize Terraform module identities. */
  host?: string;
}

const emptyResult = (): ParseResult => ({ exports: [], imports: [] });

/* -------------------------------------------------------------------------- */
/* npm                                                                        */
/* -------------------------------------------------------------------------- */

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * A dependency spec that resolves to something other than a registry version
 * (`file:`, `link:`, `workspace:`, a git URL) is not a cross-repo registry
 * consumer we can match by name alone.
 */
function isRegistrySpec(spec: string): boolean {
  return !/^(file:|link:|portal:|workspace:|git(\+|:)|https?:|github:|bitbucket:|gitlab:)/.test(
    spec.trim(),
  );
}

/**
 * Parse a `package.json` into its published identity plus its dependencies.
 *
 * A manifest counts as publishing an artifact when it has a name and is not
 * marked `private: true`. Scoping to the owner (`@owner/...`) is treated as a
 * positive signal but is not required, since many orgs publish unscoped names.
 */
export function parsePackageJson(content: string, context: ParseContext): ParseResult {
  const result = emptyResult();
  const filePath = normalizePath(context.filePath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return result; // Malformed manifest: skip rather than fail the whole index.
  }
  // A manifest that is valid JSON but not an object (`null`, `[]`, `"x"`) has nothing to index.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return result;
  const manifest = parsed as PackageManifest;

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  const isPrivate = manifest.private === true || manifest.private === 'true';

  if (name !== '' && !isPrivate) {
    result.exports.push({
      type: 'npm',
      name,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      sourceFile: filePath,
    });
  }

  const seen = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const bucket = manifest[field];
    if (bucket === null || typeof bucket !== 'object') continue;

    for (const [depName, depSpec] of Object.entries(bucket as Record<string, unknown>)) {
      if (typeof depSpec !== 'string') continue;
      if (depName === name) continue; // A manifest listing itself is not a cross-repo edge.
      if (!isRegistrySpec(depSpec)) continue;
      if (seen.has(depName)) continue;
      seen.add(depName);

      result.imports.push({
        repo: '',
        sourceFile: filePath,
        type: 'npm',
        artifactName: depName,
        versionRequirement: depSpec,
      });
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* docker                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a Dockerfile into the image it publishes plus the base images it consumes.
 *
 * The publishing side is derived from the repository identity, because a
 * Dockerfile does not name its own output image — that lives in the build
 * pipeline. Both the Docker Hub form (`owner/repo`) and the GHCR form
 * (`ghcr.io/owner/repo`) are registered so either consumer spelling matches.
 *
 * Internal multi-stage references (`FROM builder`) are excluded by tracking the
 * stage names introduced by `AS`.
 */
export function parseDockerfile(content: string, context: ParseContext): ParseResult {
  const result = emptyResult();
  const filePath = normalizePath(context.filePath);
  const stageNames = new Set<string>();
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const fromMatch = line.match(/^FROM\s+(.+)$/i);
    if (fromMatch?.[1] === undefined) continue;

    // Drop flags such as `--platform=linux/amd64`.
    const tokens = fromMatch[1]
      .split(/\s+/)
      .filter((token) => token !== '' && !token.startsWith('--'));

    const imageRef = tokens[0];
    if (imageRef === undefined) continue;

    // `FROM <image> AS <stage>` — record the stage so later FROMs can skip it.
    const asIndex = tokens.findIndex((token) => token.toUpperCase() === 'AS');
    const stageName = asIndex !== -1 ? tokens[asIndex + 1] : undefined;
    if (stageName !== undefined) stageNames.add(stageName.toLowerCase());

    if (stageNames.has(imageRef.toLowerCase())) continue; // Internal stage reference.

    const parsed = parseDockerImageRef(imageRef);
    if (parsed === null) continue;
    // A single-segment name is an official Docker Hub image (`node`, `alpine`).
    if (!parsed.name.includes('/')) continue;

    const dedupeKey = `${parsed.name}:${parsed.tag ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    result.imports.push({
      repo: '',
      sourceFile: filePath,
      type: 'docker',
      artifactName: parsed.name,
      versionRequirement: parsed.digest ?? parsed.tag ?? 'latest',
    });
  }

  const aliases = dockerImageAliases(context.owner, context.repoName);
  const primary = aliases[0];
  if (primary !== undefined) {
    result.exports.push({
      type: 'docker',
      name: primary,
      sourceFile: filePath,
      aliases: aliases.slice(1),
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* terraform                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Parse a Terraform file into the module it publishes plus the remote modules
 * it consumes.
 *
 * A `.tf` file at the repository root marks the repo as a publishable module
 * (the convention behind `terraform-<provider>-<name>` repos). Nested `.tf`
 * files only contribute consumer edges.
 */
export function parseTerraform(content: string, context: ParseContext): ParseResult {
  const result = emptyResult();
  const filePath = normalizePath(context.filePath);
  const host = context.host ?? 'github.com';
  const seen = new Set<string>();

  // Comments would otherwise yield phantom module sources.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(#|\/\/).*$/gm, '$1');

  for (const match of stripped.matchAll(/\bsource\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    const rawSource = match[1];
    if (rawSource === undefined) continue;

    const parsed = parseTerraformSource(rawSource);
    if (!parsed.isRemote) continue;
    if (!parsed.name.includes('/')) continue; // Bare registry names are not repo-identifiable.
    if (seen.has(parsed.name)) continue;
    seen.add(parsed.name);

    result.imports.push({
      repo: '',
      sourceFile: filePath,
      type: 'terraform',
      artifactName: parsed.name,
      versionRequirement: parsed.ref,
    });
  }

  const isRootModule = !filePath.includes('/');
  if (isRootModule) {
    const aliases = terraformModuleAliases(host, context.owner, context.repoName);
    const primary = aliases[0];
    if (primary !== undefined) {
      result.exports.push({
        type: 'terraform',
        name: primary,
        sourceFile: filePath,
        aliases: aliases.slice(1),
      });
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* dispatch                                                                   */
/* -------------------------------------------------------------------------- */

type FileParser = (content: string, context: ParseContext) => ParseResult;

/** Glob-free matchers describing which parser owns which filename. */
const PARSER_MATCHERS: readonly { matches: (basename: string) => boolean; parser: FileParser }[] = [
  { matches: (basename) => basename === 'package.json', parser: parsePackageJson },
  {
    matches: (basename) => basename === 'Dockerfile' || basename.startsWith('Dockerfile.'),
    parser: parseDockerfile,
  },
  { matches: (basename) => basename.endsWith('.tf'), parser: parseTerraform },
];

/** Resolve the parser for a repo-relative path, or `null` if the file is not indexable. */
function parserForPath(filePath: string): FileParser | null {
  const basename = normalizePath(filePath).split('/').pop() ?? '';
  for (const matcher of PARSER_MATCHERS) {
    if (matcher.matches(basename)) return matcher.parser;
  }
  return null;
}

/** True when a path is one this action knows how to parse. */
export function isIndexableFile(filePath: string): boolean {
  return parserForPath(filePath) !== null;
}

/** Parse a file with whichever parser owns it. Unknown files yield an empty result. */
export function parseFile(content: string, context: ParseContext): ParseResult {
  const parser = parserForPath(context.filePath);
  return parser === null ? emptyResult() : parser(content, context);
}
