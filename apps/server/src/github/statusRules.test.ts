import { NO_GITHUB_STATUS_RULES, updateGithubConnectionSchema } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { statusRuleSet, statusRulesOf, statusTrigger } from './statusRules';

const pr = (
  action: string | undefined,
  state: 'draft' | 'open' | 'merged' | 'closed',
  previous: 'draft' | 'open' | 'merged' | 'closed' | null = null,
  others: ('draft' | 'open' | 'merged' | 'closed')[] = [],
) => statusTrigger({ kind: 'pr', action, state, previous, others });

describe('GitHub status triggers', () => {
  it('fire on the action that put a pull request in each state', () => {
    expect(pr('opened', 'draft')).toBe('prDraftOpened');
    expect(pr('converted_to_draft', 'draft', 'open')).toBe('prDraftOpened');
    expect(pr('opened', 'open')).toBe('prReadyForReview');
    expect(pr('ready_for_review', 'open', 'draft')).toBe('prReadyForReview');
    expect(pr('reopened', 'open', 'closed')).toBe('prReadyForReview');
    expect(pr('closed', 'merged', 'open')).toBe('prMerged');
    expect(pr('closed', 'closed', 'open')).toBe('prClosed');
    expect(
      statusTrigger({
        kind: 'issue',
        action: 'closed',
        state: 'closed',
        previous: 'open',
        others: [],
      }),
    ).toBe('issueClosed');
  });

  it('do not fire when a delivery leaves the state as it was, or does not change state', () => {
    expect(pr('closed', 'merged', 'merged')).toBeNull();
    expect(pr('opened', 'open', 'open')).toBeNull();
    // An edited title that first links an open pull request links it without moving the task.
    expect(pr('edited', 'open')).toBeNull();
    expect(pr('synchronize', 'draft', null)).toBeNull();
    expect(pr('labeled', 'closed', 'open')).toBeNull();
    expect(pr(undefined, 'merged', 'open')).toBeNull();
    // An action whose state does not match the item is not trusted.
    expect(pr('ready_for_review', 'closed', 'open')).toBeNull();
    expect(
      statusTrigger({
        kind: 'issue',
        action: 'reopened',
        state: 'open',
        previous: 'closed',
        others: [],
      }),
    ).toBeNull();
    expect(pr('hasOwnProperty', 'open', 'draft')).toBeNull();
  });

  it('move a task with several pull requests only when the last open one closes', () => {
    expect(pr('closed', 'merged', 'open', ['open'])).toBeNull();
    expect(pr('closed', 'merged', 'open', ['draft'])).toBeNull();
    expect(pr('closed', 'merged', 'open', ['closed'])).toBe('prMerged');
    // The task's work merged in another pull request, so closing this one counts as merged.
    expect(pr('closed', 'closed', 'open', ['merged'])).toBe('prMerged');
    expect(pr('closed', 'closed', 'open', ['closed'])).toBe('prClosed');
    // A new draft does not pull a task back from review.
    expect(pr('opened', 'draft', null, ['open'])).toBeNull();
    expect(pr('opened', 'draft', null, ['merged'])).toBe('prDraftOpened');
    expect(pr('opened', 'open', null, ['draft'])).toBe('prReadyForReview');
    expect(
      statusTrigger({
        kind: 'issue',
        action: 'closed',
        state: 'closed',
        previous: 'open',
        others: ['open'],
      }),
    ).toBeNull();
  });
});

describe('GitHub status rules', () => {
  it('map to their columns and back, changing only the rules a request names', () => {
    const merged = '019a0000-0000-7000-8000-000000000004';
    expect(statusRuleSet({ prMerged: merged, prClosed: null })).toEqual({
      prMergedStatusId: merged,
      prClosedStatusId: null,
    });
    expect(
      statusRulesOf({
        prDraftOpenedStatusId: null,
        prReadyForReviewStatusId: null,
        prMergedStatusId: merged,
        prClosedStatusId: null,
        issueClosedStatusId: null,
      }),
    ).toEqual({ ...NO_GITHUB_STATUS_RULES, prMerged: merged });
  });

  it('are validated as status ids, and unknown rules are refused', () => {
    expect(
      updateGithubConnectionSchema.safeParse({ statusRules: { prMerged: null } }).success,
    ).toBe(true);
    expect(
      updateGithubConnectionSchema.safeParse({ statusRules: { prMerged: 'done' } }).success,
    ).toBe(false);
    expect(updateGithubConnectionSchema.safeParse({ statusRules: { pushed: null } }).success).toBe(
      false,
    );
  });
});
