# Contributing

Thanks for helping improve this action. This document covers the local setup, the
non-obvious rules of the repository, and what a reviewable change looks like.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Requirements

- **Node.js >= 22.** `.nvmrc` pins the development version; `nvm use` picks it up.
- npm >= 10.

## Setup

```bash
npm ci
npm run all     # format check, lint, typecheck, tests, bundle
```

`npm run all` is exactly what CI runs. If it passes locally, CI should agree.

## Everyday commands

| Command                 | What it does                                  |
| :---------------------- | :-------------------------------------------- |
| `npm test`              | Run the test suite once                       |
| `npm run test:watch`    | Re-run tests on change                        |
| `npm run test:coverage` | Tests plus coverage, enforcing the thresholds |
| `npm run typecheck`     | `tsc --noEmit` under the strict config        |
| `npm run lint`          | ESLint, type-aware rules included             |
| `npm run format`        | Rewrite files with Prettier                   |
| `npm run build`         | Bundle `src/main.ts` into `dist/index.js`     |
| `npm run build:watch`   | Rebuild the bundle on change                  |

## The one rule that surprises everyone: commit `dist/`

GitHub Actions **does not run `npm install`** for a JavaScript action. It executes
the committed `dist/index.js` directly, so the bundle is a build artifact that
must be checked in.

**Run `npm run build` and commit `dist/` with every source change.** The
`check-dist` workflow rebuilds from scratch and fails the pull request if the
committed bundle does not match the sources — that check exists so a stale bundle
can never ship.

## Architecture, and why it is shaped this way

```
action.yml        Action metadata. Must stay at the repository root (Marketplace).
src/main.ts       Entrypoint. A thin @actions/core adapter: inputs in, outputs out.
src/*.ts          The real logic, with no dependency on the Actions runtime.
src/types.ts      The graph.json contract, mirrored in the sibling repo.
tests/            Vitest suites, mirroring the src module names.
scripts/build.mjs esbuild bundler configuration.
dist/             Generated, committed. Never edit by hand.
```

Two conventions hold this together:

1. **`main.ts` stays thin.** It reads inputs, calls one function, sets outputs,
   and has a single failure surface. Everything testable lives elsewhere, which
   is why the suite needs no Actions runner.
2. **I/O goes behind an interface.** The GitHub API is reached through a
   `RepoSource`, so the same logic runs against a fixture directory on disk. Add
   new I/O the same way rather than calling Octokit from the middle of a function.

### `src/types.ts` is mirrored in the sibling repository

This action and `blast-radius-check` are separate repositories because
Marketplace publishes one action per repository. `src/types.ts` and its
`GRAPH_SCHEMA_VERSION` describe the `graph.json` contract between them.

**If you change `src/types.ts`, apply the same change to the sibling repository
and bump `GRAPH_SCHEMA_VERSION` for anything breaking.** The checker refuses a
graph whose schema version is newer than it understands, which turns a silent
misread into a clear error.

## Testing expectations

- Every behavioral change needs a test. Coverage thresholds are enforced
  (95% lines/statements, 90% functions, 85% branches).
- Test names state the behavior and, where it is not obvious, the reason:
  `'does not mistake a build stage for an external image'` beats `'parses FROM'`.
- Prefer a fixture directory or the fake Octokit in `tests/helpers/` over mocking
  internal modules.
- Parsers are the highest-risk area. New syntax support needs the odd cases too:
  comments, interpolation, multi-stage builds, alternative URL spellings.

## Adding support for a new artifact type

1. Add the type to `ArtifactType` in `src/types.ts` (and the sibling repo).
2. Add canonicalization to `src/normalize.ts`. Publisher names and consumer
   references must reduce to the same string, or nothing will ever match — this
   is the single most common source of bugs here.
3. Add a parser in `src/parsers.ts` returning `{ exports, imports }`, and
   register it in `PARSER_MATCHERS`.
4. Add tests covering both a match and a near-miss that must not match.
5. Update the supported-types table in `README.md`.

## Pull requests

- Branch from `main`; keep changes focused.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
  `fix:`, `docs:`, `chore:`) — the changelog and version bumps read from them.
- Fill in the pull request template, including the `dist/` rebuild checkbox.
- Note any change to `action.yml` inputs or outputs; those are a public contract.

## Releasing

Maintainers only:

1. Update `CHANGELOG.md`.
2. Tag the release: `git tag -a v1.2.3 -m "v1.2.3" && git push origin v1.2.3`.
3. Publish a GitHub Release from the tag, checking **"Publish this Action to the
   GitHub Marketplace"**. The `release` workflow then moves the floating `v1`
   major tag so `@v1` consumers pick the change up.
