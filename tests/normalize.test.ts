import { describe, expect, it } from 'vitest';
import {
  dockerImageAliases,
  isIgnoredPath,
  normalizePath,
  parseDockerImageRef,
  parseTerraformSource,
  terraformModuleAliases,
} from '../src/normalize';

describe('normalizePath', () => {
  it.each([
    ['./package.json', 'package.json'],
    ['/main.tf', 'main.tf'],
    ['packages\\ui\\package.json', 'packages/ui/package.json'],
    ['packages/ui/package.json', 'packages/ui/package.json'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('isIgnoredPath', () => {
  it('ignores vendored and generated trees', () => {
    expect(isIgnoredPath('node_modules/react/package.json')).toBe(true);
    expect(isIgnoredPath('infra/.terraform/modules/main.tf')).toBe(true);
    expect(isIgnoredPath('tests/fixtures/package.json')).toBe(true);
  });

  it('keeps real source paths', () => {
    expect(isIgnoredPath('packages/ui/package.json')).toBe(false);
    expect(isIgnoredPath('main.tf')).toBe(false);
  });
});

describe('parseDockerImageRef', () => {
  it('splits name and tag', () => {
    expect(parseDockerImageRef('acme/base-node:18')).toEqual({
      name: 'acme/base-node',
      tag: '18',
      digest: undefined,
    });
  });

  it('collapses Docker Hub prefixes so both spellings match', () => {
    expect(parseDockerImageRef('docker.io/acme/base')?.name).toBe('acme/base');
    expect(parseDockerImageRef('index.docker.io/library/node')?.name).toBe('node');
  });

  it('keeps non-Docker-Hub registry hosts, which are distinct images', () => {
    expect(parseDockerImageRef('ghcr.io/acme/base:18')?.name).toBe('ghcr.io/acme/base');
    expect(parseDockerImageRef('quay.io/acme/base')?.name).toBe('quay.io/acme/base');
  });

  it('treats a colon before the first slash as a registry port, not a tag', () => {
    expect(parseDockerImageRef('localhost:5000/acme/base')).toEqual({
      name: 'localhost:5000/acme/base',
      tag: undefined,
      digest: undefined,
    });
  });

  it('captures digests', () => {
    const parsed = parseDockerImageRef('acme/base@sha256:abc123');
    expect(parsed?.name).toBe('acme/base');
    expect(parsed?.digest).toBe('sha256:abc123');
  });

  it('rejects references that cannot be resolved statically', () => {
    expect(parseDockerImageRef('scratch')).toBeNull();
    expect(parseDockerImageRef('${BASE_IMAGE}')).toBeNull();
    expect(parseDockerImageRef('$BASE')).toBeNull();
    expect(parseDockerImageRef('   ')).toBeNull();
  });
});

describe('parseTerraformSource', () => {
  it('canonicalizes the git:: form down to host/owner/repo', () => {
    const parsed = parseTerraformSource(
      'git::https://github.com/acme/tf-vpc.git//modules/subnet?ref=v1.2.0',
    );
    expect(parsed).toEqual({
      name: 'github.com/acme/tf-vpc',
      subdir: 'modules/subnet',
      ref: 'v1.2.0',
      isRemote: true,
    });
  });

  it('canonicalizes every remote spelling to the same identity', () => {
    const expected = 'github.com/acme/tf-vpc';
    for (const source of [
      'github.com/acme/tf-vpc',
      'git@github.com:acme/tf-vpc.git',
      'git::ssh://git@github.com/acme/tf-vpc.git',
      'https://github.com/acme/tf-vpc',
      'git::https://github.com/acme/tf-vpc//deep/nested/path',
    ]) {
      expect(parseTerraformSource(source).name, source).toBe(expected);
    }
  });

  it('reads the rev alias as a ref', () => {
    expect(parseTerraformSource('git::https://github.com/acme/x?rev=abc').ref).toBe('abc');
  });

  it('marks local paths as non-remote', () => {
    expect(parseTerraformSource('./modules/vpc').isRemote).toBe(false);
    expect(parseTerraformSource('../shared').isRemote).toBe(false);
  });

  it('keeps registry-style sources as owner/name', () => {
    expect(parseTerraformSource('terraform-aws-modules/vpc/aws').name).toBe(
      'terraform-aws-modules/vpc',
    );
  });
});

describe('alias generation', () => {
  it('registers both Docker Hub and GHCR spellings', () => {
    expect(dockerImageAliases('Acme', 'Base-Node')).toEqual([
      'acme/base-node',
      'ghcr.io/acme/base-node',
    ]);
  });

  it('registers hosted and bare Terraform module spellings', () => {
    expect(terraformModuleAliases('github.com', 'Acme', 'TF-VPC')).toEqual([
      'github.com/acme/tf-vpc',
      'acme/tf-vpc',
    ]);
  });
});
