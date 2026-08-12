# Changelog

All notable changes to this action are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Consumers pinned to `@v1` receive every non-breaking release automatically.

## [Unreleased]

## [1.0.0] - 2026-08-12

First release as a standalone repository, split out of the original
`blast-radius-action` monorepo so it can be published to the GitHub Marketplace
(which lists one action per repository, with `action.yml` at the root).

### Added

- Organization scanning over the GitHub REST API. One recursive tree request per
  repository discovers nested manifests, so monorepo layouts
  (`packages/*/package.json`, `infra/**/*.tf`) are indexed rather than only
  root-level files.
- Support for a user account as well as an organization: the org endpoint is
  tried first and falls back to the user endpoint on 403/404.
- `local-path` input to scan a directory of repositories with no API access,
  for dry runs and tests.
- `repo-filter` (substring or `/regex/`), `include-archived`, `include-forks`,
  `max-files-per-repo`, and `concurrency` inputs.
- Outputs: `graph-path`, `repo-count`, `artifact-count`,
  `shared-artifact-count`, `consumer-edge-count`, `warning-count`.
- Job summary table reporting what was indexed.
- `schemaVersion` in `graph.json`, so the checker can refuse a graph it does not
  understand instead of misreading it.
- Deterministic serialization — sorted keys and consumer lists — so nightly
  commits of `graph.json` produce meaningful diffs.
- Warnings surfaced in both the log and the graph for skipped repositories,
  truncated git trees, and files beyond `max-files-per-repo`, so a partial index
  names its own gaps.

### Fixed

Carried over from the prototype, where these prevented the action from working
at all:

- The action had no entrypoint. `action.yml` declared `main: dist/index.js`, but
  there was no build, no bundle, and no code reading inputs — so it could not run.
- The indexer never called the GitHub API. It only walked a `mockRepoPath` that
  nothing set, requiring a token it never used and producing an empty graph.
- **Terraform edges could never match.** Consumer `source =` values were stored
  verbatim (`git::https://github.com/acme/x.git//mod?ref=v1`), which never equals
  a publisher name. Both sides are now canonicalized to `host/owner/repo`.
- **Docker edges could never match.** No parser emitted a docker *export*, so
  base-image consumers had nothing to link to. A Dockerfile now registers the
  image its repository publishes, under both the Docker Hub and GHCR spellings.
- `FROM builder` in a multi-stage build was treated as an external image. Stage
  names introduced by `AS` are now tracked and excluded.
- `FROM --platform=linux/amd64 image` parsed the flag as the image name.
- Vendored trees (`node_modules/`, `.terraform/`, `vendor/`) were indexed as
  first-party artifacts.
- A single unreadable repository aborted the entire scan.
- Unbounded parallelism against the API; requests are now capped by `concurrency`.

### Security

- Path traversal is rejected when reading from `local-path`.
- Blobs above the API's 1 MiB base64 limit are skipped with a warning rather than
  producing corrupt content.

[Unreleased]: https://github.com/mchittineni/blast-radius-indexer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mchittineni/blast-radius-indexer/releases/tag/v1.0.0
