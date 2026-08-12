import { describe, expect, it } from 'vitest';
import { buildGraph, summarizeGraph } from '../src/graph';
import type { RepositoryIndex } from '../src/types';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

const build = (repos: RepositoryIndex[]) =>
  buildGraph({ org: 'acme', generatedAt: GENERATED_AT, repos });

const publisher: RepositoryIndex = {
  repo: 'acme/core-ui-lib',
  exports: [{ type: 'npm', name: '@acme/core-ui', version: '2.1.0', sourceFile: 'package.json' }],
  imports: [],
};

const consumer: RepositoryIndex = {
  repo: 'acme/user-portal-app',
  exports: [],
  imports: [
    {
      repo: 'acme/user-portal-app',
      sourceFile: 'package.json',
      type: 'npm',
      artifactName: '@acme/core-ui',
      versionRequirement: '^2.0.0',
    },
  ],
};

describe('buildGraph', () => {
  it('links a consumer to its publisher', () => {
    const graph = build([publisher, consumer]);
    expect(graph.artifacts['npm:@acme/core-ui']?.consumers).toEqual([
      { repo: 'acme/user-portal-app', sourceFile: 'package.json', versionRequirement: '^2.0.0' },
    ]);
  });

  it('links regardless of scan order, so a consumer indexed first is not dropped', () => {
    const forward = build([publisher, consumer]);
    const reversed = build([consumer, publisher]);
    expect(reversed.artifacts['npm:@acme/core-ui']?.consumers).toEqual(
      forward.artifacts['npm:@acme/core-ui']?.consumers,
    );
  });

  it('resolves an alias spelling onto the same artifact node', () => {
    const graph = build([
      {
        repo: 'acme/base-images',
        exports: [
          {
            type: 'docker',
            name: 'acme/base-images',
            sourceFile: 'Dockerfile',
            aliases: ['ghcr.io/acme/base-images'],
          },
        ],
        imports: [],
      },
      {
        repo: 'acme/svc',
        exports: [],
        imports: [
          {
            repo: 'acme/svc',
            sourceFile: 'Dockerfile',
            type: 'docker',
            artifactName: 'ghcr.io/acme/base-images',
            versionRequirement: '18',
          },
        ],
      },
    ]);

    // The alias must not create a second, half-populated artifact.
    expect(Object.keys(graph.artifacts)).toEqual(['docker:acme/base-images']);
    expect(graph.artifacts['docker:acme/base-images']?.consumers).toHaveLength(1);
  });

  it('drops third-party dependencies that no indexed repo publishes', () => {
    const graph = build([
      {
        repo: 'acme/svc',
        exports: [],
        imports: [
          {
            repo: 'acme/svc',
            sourceFile: 'package.json',
            type: 'npm',
            artifactName: 'react',
            versionRequirement: '^18.0.0',
          },
        ],
      },
    ]);
    expect(graph.artifacts).toEqual({});
  });

  it('does not count a repository consuming its own artifact', () => {
    const graph = build([
      {
        ...publisher,
        imports: [
          {
            repo: 'acme/core-ui-lib',
            sourceFile: 'examples/package.json',
            type: 'npm',
            artifactName: '@acme/core-ui',
            versionRequirement: '^2.0.0',
          },
        ],
      },
    ]);
    expect(graph.artifacts['npm:@acme/core-ui']?.consumers).toEqual([]);
  });

  it('deduplicates identical consumer edges', () => {
    const graph = build([
      publisher,
      { ...consumer, imports: [...consumer.imports, ...consumer.imports] },
    ]);
    expect(graph.artifacts['npm:@acme/core-ui']?.consumers).toHaveLength(1);
  });

  it('serializes deterministically so graph.json diffs stay readable', () => {
    const forward = JSON.stringify(build([publisher, consumer]));
    const reversed = JSON.stringify(build([consumer, publisher]));
    expect(reversed).toBe(forward);
  });

  it('records warnings so a partial index names its own gaps', () => {
    const graph = buildGraph({
      org: 'acme',
      generatedAt: GENERATED_AT,
      repos: [],
      warnings: ['Skipped acme/secret: HTTP 404'],
    });
    expect(graph.warnings).toEqual(['Skipped acme/secret: HTTP 404']);
  });

  it('stamps the schema version the checker validates against', () => {
    expect(build([]).schemaVersion).toBe(1);
  });
});

describe('summarizeGraph', () => {
  it('counts repos, artifacts, shared artifacts and edges', () => {
    const graph = build([
      publisher,
      consumer,
      { repo: 'acme/unused-lib', exports: [], imports: [] },
    ]);
    expect(summarizeGraph(graph)).toEqual({
      repoCount: 3,
      artifactCount: 1,
      consumerEdgeCount: 1,
      sharedArtifactCount: 1,
    });
  });
});
