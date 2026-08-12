## What changed

<!-- One or two sentences. What does this do that the code did not do before? -->

## Why

<!-- The problem this solves. Link the issue if there is one: Fixes #123 -->

## How it was verified

<!-- Not "tests pass" — what specifically did you check, and how? -->

- [ ] `npm run all` passes locally
- [ ] Added or updated tests covering the change
- [ ] **Ran `npm run build` and committed `dist/`** (required for any `src/`
      or dependency change — the action runs the committed bundle, not the sources)

## Contract changes

- [ ] This changes `action.yml` inputs or outputs
- [ ] This changes `src/types.ts` or the `graph.json` shape
  - [ ] The same change was applied to the sibling repository
  - [ ] `GRAPH_SCHEMA_VERSION` was bumped if the change is breaking
- [ ] `README.md` was updated to match

<!--
If none of the boxes above apply, say so briefly rather than leaving them blank —
it tells the reviewer you considered them.
-->

## Notes for the reviewer

<!-- Anything non-obvious: a trade-off you made, a case you decided not to handle,
     an area you would like a second opinion on. -->
