import {
  GRAPH_SCHEMA_VERSION,
  artifactKey,
  type ArtifactNode,
  type GraphIndex,
  type RepositoryIndex,
} from '../shared/types';

export interface BuildGraphOptions {
  org: string;
  generatedAt: string;
  repos: readonly RepositoryIndex[];
  warnings?: readonly string[];
}

/**
 * Cross-link exports to consumers.
 *
 * Two passes are required and the order matters: every publisher must be
 * registered before any consumer edge is attached, otherwise a consumer indexed
 * before its publisher is silently dropped.
 *
 * Alias names (`ghcr.io/org/img` for `org/img`) are registered as additional
 * lookup keys pointing at the same node, so a consumer using either spelling
 * lands on one artifact rather than two half-populated ones.
 */
export function buildGraph(options: BuildGraphOptions): GraphIndex {
  const graph: GraphIndex = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    org: options.org,
    artifacts: {},
    repos: {},
  };
  if (options.warnings !== undefined && options.warnings.length > 0) {
    graph.warnings = [...options.warnings];
  }

  for (const repo of options.repos) {
    graph.repos[repo.repo] = repo;
  }

  // Pass 1 — register publishers, including every alias spelling.
  const nodesByKey = new Map<string, ArtifactNode>();
  for (const repo of options.repos) {
    for (const declaration of repo.exports) {
      const primaryKey = artifactKey(declaration.type, declaration.name);
      let node = nodesByKey.get(primaryKey);

      if (node === undefined) {
        node = {
          type: declaration.type,
          name: declaration.name,
          publisherRepo: repo.repo,
          publisherFile: declaration.sourceFile,
          consumers: [],
        };
        nodesByKey.set(primaryKey, node);
        graph.artifacts[primaryKey] = node;
      }

      for (const alias of declaration.aliases ?? []) {
        const aliasKey = artifactKey(declaration.type, alias);
        if (!nodesByKey.has(aliasKey)) nodesByKey.set(aliasKey, node);
      }
    }
  }

  // Pass 2 — attach consumer edges, skipping self-references and duplicates.
  const edgeKeys = new Set<string>();
  for (const repo of options.repos) {
    for (const consumer of repo.imports) {
      const node = nodesByKey.get(artifactKey(consumer.type, consumer.artifactName));
      if (node === undefined) continue; // Third-party dependency: not in this org.
      if (node.publisherRepo === repo.repo) continue; // A repo consuming itself is not blast radius.

      const edgeKey = `${node.type}:${node.name}|${repo.repo}|${consumer.sourceFile}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);

      node.consumers.push({
        repo: repo.repo,
        sourceFile: consumer.sourceFile,
        versionRequirement: consumer.versionRequirement,
      });
    }
  }

  // Deterministic ordering keeps `graph.json` diffs meaningful between runs.
  for (const node of Object.values(graph.artifacts)) {
    node.consumers.sort(
      (left, right) =>
        left.repo.localeCompare(right.repo) || left.sourceFile.localeCompare(right.sourceFile),
    );
  }

  return sortGraph(graph);
}

/** Rebuild the record keys in sorted order so serialization is stable. */
function sortGraph(graph: GraphIndex): GraphIndex {
  const sortedArtifacts: Record<string, ArtifactNode> = {};
  for (const key of Object.keys(graph.artifacts).sort()) {
    const node = graph.artifacts[key];
    if (node !== undefined) sortedArtifacts[key] = node;
  }

  const sortedRepos: Record<string, RepositoryIndex> = {};
  for (const key of Object.keys(graph.repos).sort()) {
    const repo = graph.repos[key];
    if (repo !== undefined) sortedRepos[key] = repo;
  }

  graph.artifacts = sortedArtifacts;
  graph.repos = sortedRepos;
  return graph;
}

export interface GraphStats {
  repoCount: number;
  artifactCount: number;
  consumerEdgeCount: number;
  /** Artifacts published in-org that at least one other repo consumes. */
  sharedArtifactCount: number;
}

export function summarizeGraph(graph: GraphIndex): GraphStats {
  const nodes = Object.values(graph.artifacts);
  return {
    repoCount: Object.keys(graph.repos).length,
    artifactCount: nodes.length,
    consumerEdgeCount: nodes.reduce((total, node) => total + node.consumers.length, 0),
    sharedArtifactCount: nodes.filter((node) => node.consumers.length > 0).length,
  };
}
