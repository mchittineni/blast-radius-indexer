# Publishing this action to the GitHub Marketplace

## Which requirements apply

GitHub has **two separate Marketplace programs**, with different rules:

|                                       | **Apps** (GitHub Apps / OAuth apps) | **Actions** (this repository)    |
| :------------------------------------ | :---------------------------------- | :------------------------------- |
| Pricing plan required                 | Yes                                 | **No** — Actions are always free |
| Marketplace API purchase webhooks     | Yes                                 | **No**                           |
| Privacy policy + support URL required | Yes                                 | **No**                           |
| Publisher verification for paid plans | Yes                                 | **No**                           |
| Minimum installs (100) / users (200)  | Yes, for paid                       | **No**                           |
| `action.yml` at the repository root   | n/a                                 | **Yes**                          |
| One per repository                    | n/a                                 | **Yes**                          |
| Published from a release tag          | n/a                                 | **Yes**                          |

This repository publishes an **Action**, so the App requirements — pricing plans,
purchase events, the Marketplace billing API, publisher verification — **do not
apply**. The requirement that governs this repository's layout is the one in the
right-hand column: one action per repository, with `action.yml` at the root.

Reference: [Publishing actions in GitHub Marketplace](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).

## Why this is its own repository

Marketplace lists **one action per repository** and reads `action.yml` from the
**repository root**. The original `blast-radius-action` layout kept two actions in
subdirectories (`index-repo/`, `check-action/`), which meant neither could be
listed. Splitting them gives each its own root `action.yml`, its own release
cadence, and its own listing:

- `blast-radius-indexer` — this repository, builds `graph.json`
- `blast-radius-check` — reads `graph.json` and comments on pull requests

`shared/` is duplicated in both. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the
rule about keeping `GRAPH_SCHEMA_VERSION` in sync.

## Pre-publish checklist

### Required by GitHub

- [ ] The repository is **public**.
- [ ] `action.yml` is at the **repository root** — not in a subdirectory.
- [ ] `action.yml` has a `name`, and that name is **unique across Marketplace**.
      It must not collide with an existing listing, an existing GitHub user or
      organization name, or a GitHub feature or product name.
- [ ] `action.yml` has a `description`.
- [ ] `action.yml` has a `branding` block with an `icon` and a `color`.
      This repository uses `icon: git-merge`, `color: purple`. The icon must be a
      [Feather](https://feathericons.com/) icon name; the color must be one of
      `white`, `yellow`, `blue`, `green`, `orange`, `red`, `purple`, `gray-dark`.
- [ ] The repository has a `README.md` describing what the action does and how to
      use it.
- [ ] **Two-factor authentication is enabled** on the publishing account.
- [ ] You have read and accepted the
      [GitHub Marketplace Developer Agreement](https://docs.github.com/en/site-policy/github-terms/github-marketplace-developer-agreement)
      (presented during the publish flow).

### Required by this repository before tagging

- [x] `.github/CODEOWNERS` names a resolvable owner.
- [x] Repository links in `README.md`, `SECURITY.md`, and the `CHANGELOG.md`
      compare links point at the real `owner/repo`.
- [ ] `npm run all` passes.
- [ ] `dist/` is rebuilt and committed (`check-dist` enforces this).
- [ ] `CHANGELOG.md` has an entry for the version.
- [ ] The `runs.using` runtime is still one GitHub supports (`node20` / `node24`).

## Publishing

1. Commit everything, including `dist/`.
2. Tag and push a semver release tag:

   ```bash
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   ```

3. On GitHub, go to **Releases → Draft a new release**, choose the tag, and write
   release notes (the `CHANGELOG.md` entry works).
4. Check **"Publish this Action to the GitHub Marketplace"**. GitHub validates
   `action.yml` at this point and reports anything missing.
5. Accept the Developer Agreement if prompted, pick a category, and publish.
6. The `release` workflow then moves the floating `v1` tag onto the release, so
   `@v1` consumers pick it up.

## After publishing

- **Keep the major tag moving.** Consumers pin `@v1`; the `release` workflow
  handles this, but verify it ran.
- **Removing a listing** does not delete the action. It stays usable via
  `uses: mchittineni/blast-radius-indexer@v1`.
- **Breaking changes** get a new major tag (`v2`) and a new floating tag. Leave
  `v1` pointing at the last compatible release.

## Recommendations that are not requirements

- Pin third-party actions in your own workflows by commit SHA.
- Keep the README's inputs and outputs tables generated from `action.yml` by hand
  or in CI; a drifting table is the most common documentation bug in actions.
- Add repository topics (`github-actions`, `dependency-graph`) — Marketplace
  search uses them.
