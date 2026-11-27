import { createHash, createHmac, randomUUID } from 'node:crypto';
import { GITHUB_HEADERS } from '@throw/shared';
import { signWebhookBody } from '../webhooks/signing';

export const demoRepository = 'iiloni/throw';
export const demoSecret = (serverSecret: string) =>
  'throw_ghsec_' +
  createHmac('sha256', serverSecret).update('Throw demo GitHub webhook').digest('base64url');

export function simulatedEvent(
  command: string,
  repo: string,
  task = '',
  options: {
    pr?: number;
    issue?: number;
    tag?: string;
    now?: Date;
    title?: string;
  } = {},
) {
  const repository = { full_name: repo };
  const now = options.now ?? new Date();
  const at = now.toISOString();
  const tag = options.tag ?? 'v0.2.0';
  if (command === 'ping')
    return { event: 'ping', payload: { repository, zen: 'Keep it logically awesome.' } };
  if (command === 'release')
    return {
      event: 'release',
      payload: {
        repository,
        action: 'published',
        release: {
          tag_name: tag,
          name: tag,
          target_commitish: 'main',
          draft: false,
          prerelease: false,
          published_at: at,
        },
      },
    };
  if (command === 'tag')
    return {
      event: 'push',
      payload: {
        repository,
        ref: `refs/tags/${tag}`,
        before: '0'.repeat(40),
        after: createHash('sha1').update(tag).digest('hex'),
        deleted: false,
      },
    };

  const match = /^[a-z][a-z0-9]*-([1-9]\d*)$/i.exec(task);
  if (!match) throw new Error('Supply a task key, for example THR-1.');
  const issue = command.startsWith('issue-');
  const number = (issue ? options.issue : options.pr) ?? Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 2147483647)
    throw new Error('Invalid GitHub item number');
  const item = {
    number,
    title: `${task.toUpperCase()} ${options.title ?? 'Update the project'}`,
    body: '',
    state: ['issue-close', 'pr-close', 'pr-merge'].includes(command) ? 'closed' : 'open',
    updated_at: at,
  };
  const sha = createHash('sha1').update(`${repo.toLowerCase()}#${number}`).digest('hex');
  const pull_request = {
    ...item,
    draft: command === 'pr-draft',
    merged: command === 'pr-merge',
    merged_at: command === 'pr-merge' ? at : null,
    merge_commit_sha: command === 'pr-merge' ? createHash('sha1').update(sha).digest('hex') : null,
    head: { ref: `work/${task.toLowerCase()}`, sha },
  };
  switch (command) {
    case 'issue-open':
    case 'issue-close':
      return {
        event: 'issues',
        payload: {
          repository,
          action: command === 'issue-open' ? 'opened' : 'closed',
          issue: item,
        },
      };
    case 'pr-draft':
    case 'pr-ready':
    case 'pr-close':
    case 'pr-merge':
      return {
        event: 'pull_request',
        payload: {
          repository,
          action:
            command === 'pr-draft'
              ? 'opened'
              : command === 'pr-ready'
                ? 'ready_for_review'
                : 'closed',
          pull_request,
        },
      };
    case 'checks-fail':
    case 'checks-pass':
    case 'checks-pending':
      return {
        event: 'check_run',
        payload: {
          repository,
          action: command === 'checks-pending' ? 'created' : 'completed',
          check_run: {
            id: now.getTime(),
            name: 'CI',
            head_sha: sha,
            pull_requests: [{ number }],
            updated_at: at,
            status: command === 'checks-pending' ? 'in_progress' : 'completed',
            conclusion:
              command === 'checks-pending'
                ? null
                : command === 'checks-pass'
                  ? 'success'
                  : 'failure',
          },
        },
      };
    case 'review-changes':
    case 'review-approve':
      return {
        event: 'pull_request_review',
        payload: {
          repository,
          action: 'submitted',
          pull_request,
          review: {
            id: now.getTime(),
            user: { id: 42, login: 'demo-reviewer' },
            state: command === 'review-changes' ? 'changes_requested' : 'approved',
          },
        },
      };
    default:
      throw new Error(`Unknown github-sim event: ${command}`);
  }
}

export function signedDelivery(input: ReturnType<typeof simulatedEvent>, secret: string) {
  const body = JSON.stringify(input.payload);
  return {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      [GITHUB_HEADERS.signature]: signWebhookBody(secret, body),
      [GITHUB_HEADERS.event]: input.event,
      [GITHUB_HEADERS.delivery]: randomUUID(),
    },
  };
}
