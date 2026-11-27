import { GITHUB_HEADERS } from '@throw/shared';
import { expect, it } from 'vitest';
import { verifyGithubSignature } from '../github/secrets';
import { demoSecret, signedDelivery, simulatedEvent } from './githubEvents';

it('signs the exact delivered JSON with a new delivery id for each send', () => {
  const secret = demoSecret('local key');
  const item = simulatedEvent('pr-ready', 'org/repo', 'ABC-7', { pr: 32, title: 'Fix 漢字' });
  const first = signedDelivery(item, secret);
  const second = signedDelivery(item, secret);
  expect(first.headers[GITHUB_HEADERS.delivery]).not.toBe(second.headers[GITHUB_HEADERS.delivery]);
  expect(first.headers[GITHUB_HEADERS.event]).toBe('pull_request');
  expect(
    verifyGithubSignature(secret, Buffer.from(first.body), first.headers[GITHUB_HEADERS.signature]),
  ).toBe(true);
  expect(
    verifyGithubSignature(
      secret,
      Buffer.from(`${first.body} `),
      first.headers[GITHUB_HEADERS.signature],
    ),
  ).toBe(false);
  expect(JSON.parse(first.body)).toMatchObject({
    repository: { full_name: 'org/repo' },
    action: 'ready_for_review',
    pull_request: { number: 32, title: 'ABC-7 Fix 漢字' },
  });
});

it('targets the same PR head across a draft, check and merge', () => {
  const event = (name: string) => simulatedEvent(name, 'demo/project', 'THR-29').payload;
  const head = event('pr-draft').pull_request?.head;
  expect(head?.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(event('checks-fail').check_run).toMatchObject({
    head_sha: head?.sha,
    conclusion: 'failure',
    pull_requests: [{ number: 29 }],
  });
  expect(event('pr-merge').pull_request).toMatchObject({ head, state: 'closed', merged: true });
  expect(event('issue-close').issue).toMatchObject({ number: 29, state: 'closed' });
  expect(event('release').release).toMatchObject({ tag_name: 'v0.2.0', draft: false });
});
