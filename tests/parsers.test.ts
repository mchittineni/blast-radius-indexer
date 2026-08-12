import { describe, expect, it } from 'vitest';
import {
  isIndexableFile,
  parseDockerfile,
  parseFile,
  parsePackageJson,
  parseTerraform,
  type ParseContext,
} from '../src/parsers';

const context = (filePath: string): ParseContext => ({
  owner: 'acme',
  repoName: 'core-ui-lib',
  filePath,
});

describe('parsePackageJson', () => {
  it('records a publishable manifest as an export', () => {
    const result = parsePackageJson(
      JSON.stringify({ name: '@acme/core-ui', version: '2.1.0' }),
      context('package.json'),
    );
    expect(result.exports).toEqual([
      { type: 'npm', name: '@acme/core-ui', version: '2.1.0', sourceFile: 'package.json' },
    ]);
  });

  it('does not treat a private manifest as published', () => {
    const result = parsePackageJson(
      JSON.stringify({ name: '@acme/internal', private: true }),
      context('package.json'),
    );
    expect(result.exports).toEqual([]);
  });

  it('collects every dependency bucket exactly once', () => {
    const result = parsePackageJson(
      JSON.stringify({
        name: '@acme/app',
        dependencies: { '@acme/core-ui': '^2.0.0' },
        devDependencies: { '@acme/core-ui': '^2.0.0', typescript: '^5.0.0' },
        peerDependencies: { react: '^18.0.0' },
        optionalDependencies: { fsevents: '^2.0.0' },
      }),
      context('package.json'),
    );

    expect(result.imports.map((entry) => entry.artifactName)).toEqual([
      '@acme/core-ui',
      'typescript',
      'react',
      'fsevents',
    ]);
  });

  it('skips specs that are not registry references', () => {
    const result = parsePackageJson(
      JSON.stringify({
        name: '@acme/app',
        dependencies: {
          '@acme/local': 'file:../local',
          '@acme/ws': 'workspace:*',
          '@acme/git': 'github:acme/thing',
          '@acme/real': '^1.0.0',
        },
      }),
      context('package.json'),
    );
    expect(result.imports.map((entry) => entry.artifactName)).toEqual(['@acme/real']);
  });

  it('ignores a manifest that lists itself', () => {
    const result = parsePackageJson(
      JSON.stringify({ name: '@acme/app', dependencies: { '@acme/app': '^1.0.0' } }),
      context('package.json'),
    );
    expect(result.imports).toEqual([]);
  });

  it('survives malformed JSON without throwing', () => {
    expect(parsePackageJson('{ not json', context('package.json'))).toEqual({
      exports: [],
      imports: [],
    });
  });
});

describe('parseDockerfile', () => {
  it('derives the published image from the repository identity', () => {
    const result = parseDockerfile('FROM node:22\n', context('Dockerfile'));
    expect(result.exports).toEqual([
      {
        type: 'docker',
        name: 'acme/core-ui-lib',
        sourceFile: 'Dockerfile',
        aliases: ['ghcr.io/acme/core-ui-lib'],
      },
    ]);
  });

  it('ignores official single-segment base images', () => {
    const result = parseDockerfile('FROM node:22\nFROM alpine\n', context('Dockerfile'));
    expect(result.imports).toEqual([]);
  });

  it('records org base images with their tag', () => {
    const result = parseDockerfile('FROM ghcr.io/acme/base-node:18\n', context('Dockerfile'));
    expect(result.imports).toMatchObject([
      { type: 'docker', artifactName: 'ghcr.io/acme/base-node', versionRequirement: '18' },
    ]);
  });

  it('does not mistake a build stage for an external image', () => {
    const result = parseDockerfile(
      ['FROM acme/base-node:18 AS builder', 'RUN npm ci', 'FROM builder', 'CMD ["node"]'].join(
        '\n',
      ),
      context('Dockerfile'),
    );
    expect(result.imports.map((entry) => entry.artifactName)).toEqual(['acme/base-node']);
  });

  it('strips FROM flags such as --platform', () => {
    const result = parseDockerfile(
      'FROM --platform=linux/amd64 acme/base-node:20 AS base\n',
      context('Dockerfile'),
    );
    expect(result.imports.map((entry) => entry.artifactName)).toEqual(['acme/base-node']);
  });

  it('skips commented-out and unresolvable FROM lines', () => {
    const result = parseDockerfile(
      ['# FROM acme/commented:1', 'ARG BASE=acme/x', 'FROM ${BASE}'].join('\n'),
      context('Dockerfile'),
    );
    expect(result.imports).toEqual([]);
  });
});

describe('parseTerraform', () => {
  it('marks a root .tf file as publishing the repo as a module', () => {
    const result = parseTerraform('variable "name" {}\n', context('main.tf'));
    expect(result.exports).toEqual([
      {
        type: 'terraform',
        name: 'github.com/acme/core-ui-lib',
        sourceFile: 'main.tf',
        aliases: ['acme/core-ui-lib'],
      },
    ]);
  });

  it('does not treat a nested .tf file as a published root module', () => {
    const result = parseTerraform('variable "name" {}\n', context('infra/envs/prod/main.tf'));
    expect(result.exports).toEqual([]);
  });

  it('canonicalizes remote module sources so they can match a publisher', () => {
    const result = parseTerraform(
      [
        'module "vpc" {',
        '  source = "git::https://github.com/acme/tf-vpc.git//modules/vpc?ref=v1.4.0"',
        '}',
        'module "local" {',
        '  source = "./modules/thing"',
        '}',
      ].join('\n'),
      context('main.tf'),
    );

    expect(result.imports).toMatchObject([
      {
        type: 'terraform',
        artifactName: 'github.com/acme/tf-vpc',
        versionRequirement: 'v1.4.0',
      },
    ]);
  });

  it('ignores sources inside comments', () => {
    const result = parseTerraform(
      ['# source = "github.com/acme/ghost"', '/* source = "github.com/acme/ghost2" */'].join('\n'),
      context('main.tf'),
    );
    expect(result.imports).toEqual([]);
  });
});

describe('parser dispatch', () => {
  it.each([
    ['package.json', true],
    ['packages/ui/package.json', true],
    ['Dockerfile', true],
    ['Dockerfile.prod', true],
    ['infra/main.tf', true],
    ['README.md', false],
    ['package-lock.json', false],
  ])('treats %s as indexable=%s', (filePath, expected) => {
    expect(isIndexableFile(filePath)).toBe(expected);
  });

  it('returns an empty result for unknown files', () => {
    expect(parseFile('# hello', context('README.md'))).toEqual({ exports: [], imports: [] });
  });
});
