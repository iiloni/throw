import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reusablePrRun } from './pr-ci-reuse.ts';

const mergeSha = 'a'.repeat(40);
const request = { runId: 50, prNumber: 17, mergeSha };
const marker = `Full CI for PR 17 at ${mergeSha}`;

function run(id: number, overrides: Record<string, string> = {}) {
  return {
    id,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'failure',
    ...overrides,
  };
}

function result(name: string, conclusion = 'success') {
  return { name, status: 'completed', conclusion };
}

function fullJobs(stepName = marker) {
  return [
    { ...result('check'), steps: [result(stepName)] },
    ...['android build', 'e2e (desktop)', 'e2e (android)'].map((name) => ({
      ...result(name),
      steps: [],
    })),
  ];
}

test('draft CI can be reused after all four required jobs pass', async () => {
  assert.equal(
    await reusablePrRun(request, { workflow_runs: [run(20)] }, async () => ({ jobs: fullJobs() })),
    20,
  );
});

test('a PR run must record the exact PR number and checked-out merge SHA', async () => {
  for (const stepName of [
    'Run pnpm check',
    `Full CI for PR 18 at ${mergeSha}`,
    `Full CI for PR 17 at ${'b'.repeat(40)}`,
  ]) {
    assert.equal(
      await reusablePrRun(request, { workflow_runs: [run(20)] }, async () => ({
        jobs: fullJobs(stepName),
      })),
      null,
    );
  }
});

test('failed, canceled, skipped or missing jobs cannot supply evidence', async () => {
  for (const required of fullJobs()) {
    for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
      const jobs = fullJobs().map((job) =>
        job.name === required.name ? { ...job, conclusion } : job,
      );
      assert.equal(
        await reusablePrRun(request, { workflow_runs: [run(20)] }, async () => ({ jobs })),
        null,
      );
    }
  }
  for (const jobs of [
    fullJobs().slice(0, -1),
    fullJobs().map((job) =>
      job.name === 'check' ? { ...job, steps: [result(marker, 'failure')] } : job,
    ),
  ]) {
    assert.equal(
      await reusablePrRun(request, { workflow_runs: [run(20)] }, async () => ({ jobs })),
      null,
    );
  }
});

test('ignore other workflows, current runs, and label runs without verification jobs', async () => {
  const response = {
    workflow_runs: [
      run(25),
      run(60),
      run(50),
      run(45, { event: 'push' }),
      run(40, { path: '.github/workflows/other.yml' }),
      run(35, { status: 'in_progress' }),
      run(30),
    ],
  };
  const read: number[] = [];
  const reused = await reusablePrRun(request, response, async (id) => {
    read.push(id);
    return { jobs: id === 30 ? [] : fullJobs() };
  });
  assert.equal(reused, 25);
  assert.deepEqual(read, [30, 25]);
});

test('a later canceled or failing test run supersedes an earlier pass for the same snapshot', async () => {
  for (const conclusion of ['cancelled', 'failure']) {
    const response = { workflow_runs: [run(25), run(30, { conclusion })] };
    const reused = await reusablePrRun(request, response, async (id) => {
      assert.equal(id, 30);
      return { jobs: conclusion === 'failure' ? fullJobs().slice(0, -1) : fullJobs() };
    });
    assert.equal(reused, null);
  }
});
