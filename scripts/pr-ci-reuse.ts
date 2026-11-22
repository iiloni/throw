import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { e2eJobs, requiredJobs } from './wait-for-ci.ts';

const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      path: z.string(),
      event: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});
const resultSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});
const jobsSchema = z.object({
  jobs: z.array(resultSchema.extend({ steps: z.array(resultSchema) })),
});
function passed(result: z.infer<typeof resultSchema> | undefined) {
  return result?.status === 'completed' && result.conclusion === 'success';
}

export async function reusablePrRun(
  { runId, prNumber, mergeSha }: { runId: number; prNumber: number; mergeSha: string },
  input: unknown,
  readJobs: (id: number) => Promise<unknown>,
) {
  const runs = runsSchema
    .parse(input)
    .workflow_runs.filter(
      (run) =>
        run.id < runId &&
        run.path === '.github/workflows/ci.yml' &&
        run.event === 'pull_request' &&
        run.status === 'completed',
    )
    .sort((a, b) => b.id - a.id);

  // GitHub reports the PR head as head_sha. The checkout step verifies the merge SHA
  // and records it in GitHub's step metadata with the PR number.
  const marker = `Full CI for PR ${prNumber} at ${mergeSha}`;
  for (const run of runs) {
    const { jobs } = jobsSchema.parse(await readJobs(run.id));
    const check = jobs.find((job) => job.name === 'check');
    const recorded = check?.steps.find((step) => step.name === marker);
    if (!recorded) continue;
    if (
      recorded.conclusion === 'skipped' &&
      passed(check) &&
      e2eJobs.every((name) =>
        jobs.some(
          (job) => job.name === name && job.status === 'completed' && job.conclusion === 'skipped',
        ),
      )
    ) {
      // A passing check and skipped aggregates identify a run without full E2E.
      continue;
    }

    // A newer attempt to test this snapshot takes precedence over an older pass.
    // Draft validation can fail for lack of approval even when every test job passed.
    const completed = run.conclusion === 'success' || run.conclusion === 'failure';
    return completed &&
      passed(recorded) &&
      requiredJobs.every((name) => passed(jobs.find((job) => job.name === name)))
      ? run.id
      : null;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);
  let source: number | null = null;
  try {
    const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA, PR_HEAD_SHA, PR_NUMBER } = process.env;
    const sha = z.string().regex(/^[a-f0-9]{40}$/);
    const id = z.coerce.number().int().positive();
    const repo = z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .parse(GITHUB_REPOSITORY);
    const request = {
      runId: id.parse(GITHUB_RUN_ID),
      prNumber: id.parse(PR_NUMBER),
      mergeSha: sha.parse(GITHUB_SHA),
    };
    const head = sha.parse(PR_HEAD_SHA);
    const signal = AbortSignal.timeout(12_000);
    const exec = promisify(execFile);
    const read = async (endpoint: string): Promise<unknown> => {
      const { stdout } = await exec('gh', ['api', `repos/${repo}/actions/${endpoint}`], { signal });
      return JSON.parse(stdout);
    };
    source = await reusablePrRun(
      request,
      await read(`workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=20`),
      // GitHub carries successful jobs forward when only failed jobs are rerun.
      (run) => read(`runs/${run}/jobs?filter=latest&per_page=100`),
    );
  } catch {
    // Evidence is an optimization. Unavailable or unexpected API data requests fresh CI.
    source = null;
    console.log('Could not verify previous PR checks. Running fresh CI.');
  }

  if (source !== null) console.log(`Reusing full PR CI from run ${source}.`);
  appendFileSync(
    output,
    source === null ? 'run_checks=true\n' : `run_checks=false\npr_ci_source=${source}\n`,
  );
}
