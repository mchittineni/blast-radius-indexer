import { pathToFileURL } from 'node:url';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { booleanInput, optionalInput, positiveIntInput, stringInput } from '../shared/inputs';
import { runIndexer } from './index';

/**
 * Action entrypoint for the org indexer.
 *
 * Nothing here does real work: inputs in, {@link runIndexer} out, then outputs,
 * a job summary, and a single failure surface. Keeping the adapter this thin is
 * what makes the indexing logic testable without a runner.
 */
export async function run(): Promise<void> {
  try {
    const org = core.getInput('org-name', { required: true }).trim();
    const outputPath = stringInput('output-path', 'graph.json');
    const token = core.getInput('github-token');
    const localPath = optionalInput('local-path');

    if (localPath === undefined && token.trim() === '') {
      throw new Error('`github-token` is required unless `local-path` is set.');
    }

    const outcome = await runIndexer({
      org,
      outputPath,
      localPath,
      octokit: localPath === undefined ? github.getOctokit(token) : undefined,
      includeArchived: booleanInput('include-archived', false),
      includeForks: booleanInput('include-forks', false),
      repoFilter: optionalInput('repo-filter'),
      maxFilesPerRepo: positiveIntInput('max-files-per-repo', 200),
      concurrency: positiveIntInput('concurrency', 8),
      onProgress: (message) => {
        core.info(message);
      },
    });

    const { stats } = outcome;
    core.setOutput('graph-path', outcome.outputPath);
    core.setOutput('repo-count', stats.repoCount);
    core.setOutput('artifact-count', stats.artifactCount);
    core.setOutput('shared-artifact-count', stats.sharedArtifactCount);
    core.setOutput('consumer-edge-count', stats.consumerEdgeCount);
    core.setOutput('warning-count', outcome.warnings.length);

    for (const warning of outcome.warnings) core.warning(warning);

    await core.summary
      .addHeading('💥 Blast Radius Index', 2)
      .addRaw(`Graph written to \`${outcome.outputPath}\` for \`${org}\`.`)
      .addTable([
        [
          { data: 'Metric', header: true },
          { data: 'Count', header: true },
        ],
        ['Repositories indexed', String(stats.repoCount)],
        ['Artifacts discovered', String(stats.artifactCount)],
        ['Shared artifacts (≥1 consumer)', String(stats.sharedArtifactCount)],
        ['Consumer edges', String(stats.consumerEdgeCount)],
        ['Warnings', String(outcome.warnings.length)],
      ])
      .write();

    if (stats.repoCount === 0) {
      core.warning(
        'No repositories were indexed. Check `org-name`, the token scopes, and `repo-filter`.',
      );
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

// Run when executed directly (the bundled `dist/index.js`), not when imported by
// a test. `require.main` does not exist in ESM, so compare resolved paths instead.
/* c8 ignore next 3 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
