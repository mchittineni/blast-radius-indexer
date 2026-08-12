/**
 * Shared contract between the indexer action and the PR checker action.
 *
 * `graph.json` is the serialized form of {@link GraphIndex}. It is a public,
 * versioned artifact: bump {@link GRAPH_SCHEMA_VERSION} on any breaking change
 * so the checker can refuse to read a graph it does not understand.
 */

export const GRAPH_SCHEMA_VERSION = 1;

export type ArtifactType = 'npm' | 'docker' | 'terraform' | 'custom';

/** Something a repository publishes for other repositories to consume. */
export interface ArtifactDeclaration {
  type: ArtifactType;
  /** Canonical name, e.g. `@my-org/core-ui`, `my-org/base-node`, `github.com/my-org/tf-vpc`. */
  name: string;
  version?: string | undefined;
  /** Repo-relative path of the file that declares it, e.g. `packages/ui/package.json`. */
  sourceFile: string;
  /**
   * Additional names the same artifact is legitimately referenced by
   * (e.g. a container image reachable as both `org/img` and `ghcr.io/org/img`).
   */
  aliases?: readonly string[] | undefined;
}

/** A reference from one repository to an artifact published elsewhere. */
export interface ArtifactConsumer {
  /** `owner/name`. Empty while parsing; filled in by the scanner. */
  repo: string;
  /** Repo-relative path of the file holding the reference. */
  sourceFile: string;
  type: ArtifactType;
  artifactName: string;
  versionRequirement?: string | undefined;
}

export interface RepositoryIndex {
  repo: string;
  /** Default branch the index was built from. */
  defaultBranch?: string | undefined;
  exports: ArtifactDeclaration[];
  imports: ArtifactConsumer[];
}

export interface ArtifactConsumerRef {
  repo: string;
  sourceFile: string;
  versionRequirement?: string | undefined;
}

export interface ArtifactNode {
  type: ArtifactType;
  name: string;
  publisherRepo: string;
  publisherFile: string;
  consumers: ArtifactConsumerRef[];
}

export interface GraphIndex {
  schemaVersion: number;
  generatedAt: string;
  org: string;
  /** Repos that were skipped, and why — keeps a partial index honest. */
  warnings?: string[] | undefined;
  /** Keyed by `${type}:${name}` — see `artifactKey()`. */
  artifacts: Record<string, ArtifactNode>;
  /** Keyed by `owner/name`. */
  repos: Record<string, RepositoryIndex>;
}

/** Stable identity for an artifact across both actions. */
export function artifactKey(type: ArtifactType, name: string): string {
  return `${type}:${name}`;
}
