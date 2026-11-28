import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { TaskGithubLink } from '@throw/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  link: vi.fn(),
  unlink: vi.fn(),
  connection: vi.fn(),
  awaited: [] as number[],
}));
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: { linkGithub: fake.link, unlinkGithub: fake.unlink, githubConnection: fake.connection },
}));
vi.mock('./collections', () => ({
  awaitGithubLinksTxid: async (txid: number) => {
    fake.awaited.push(txid);
    return true;
  },
}));

const { ApiError } = await import('./api');
const {
  compareGithubLinks,
  GithubLinkError,
  githubChecksText,
  githubLinkLabel,
  githubTone,
  linkGithub,
  pastedGithubLink,
  pullRequestsByTask,
  sortGithubLinks,
  unlinkGithub,
  useGithubRepository,
  useShownGithubLinks,
  resetGithubRepositories,
} = await import('./githubLinks');

let next = 0;
function link(extra: Partial<TaskGithubLink> = {}): TaskGithubLink {
  next += 1;
  return {
    id: `0199a0a0-0000-7000-8000-${String(next).padStart(12, '0')}`,
    workspaceId: 'w',
    projectId: 'p',
    taskId: 't1',
    repo: 'org/repo',
    kind: 'pr',
    number: next,
    url: `https://github.com/org/repo/pull/${next}`,
    title: `Item ${next}`,
    state: 'open',
    reviewDecision: null,
    checksSummary: null,
    branch: null,
    mergeCommitSha: null,
    mergedAt: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...extra,
  };
}
const checks = (state: 'passing' | 'failing' | 'pending', failed = 0, pending = 0, passed = 0) => ({
  state,
  failed,
  pending,
  passed,
});

afterEach(() => {
  // Unmounted first, so forgetting the repositories asks no mounted hook to ask again.
  cleanup();
  vi.clearAllMocks();
  fake.awaited = [];
  resetGithubRepositories();
});

describe('GitHub link wording', () => {
  it('tints by state as GitHub does, and a failing open pull request red', () => {
    expect(githubTone(link())).toBe('green');
    expect(githubTone(link({ state: 'draft' }))).toBe('gray');
    expect(githubTone(link({ state: 'merged' }))).toBe('violet');
    expect(githubTone(link({ state: 'closed' }))).toBe('red');
    expect(githubTone(link({ kind: 'issue', state: 'closed' }))).toBe('violet');
    expect(githubTone(link({ checksSummary: checks('failing', 1) }))).toBe('red');
    expect(githubTone(link({ state: 'draft', checksSummary: checks('failing', 1) }))).toBe('red');
    // Finished work keeps its state's color whatever its last checks said.
    expect(githubTone(link({ state: 'merged', checksSummary: checks('failing', 1) }))).toBe(
      'violet',
    );
  });

  it('counts checks failures first, leaving out none', () => {
    expect(githubChecksText(checks('failing', 1, 0, 4))).toBe('1 failed, 4 passed');
    expect(githubChecksText(checks('pending', 0, 2, 1))).toBe('2 pending, 1 passed');
    expect(githubChecksText(checks('passing'))).toBe('No checks');
  });

  it('names a link with its review and checks, and an issue without them', () => {
    expect(
      githubLinkLabel(
        link({
          number: 9,
          title: 'Fix',
          reviewDecision: 'changes_requested',
          checksSummary: checks('pending', 0, 1, 2),
        }),
      ),
    ).toBe('Pull request org/repo#9: Fix, Open, Changes requested, checks 1 pending, 2 passed');
    expect(
      githubLinkLabel(
        link({
          kind: 'issue',
          number: 3,
          title: 'Bug',
          state: 'closed',
          reviewDecision: 'pending',
        }),
      ),
    ).toBe('Issue org/repo#3: Bug, Closed');
  });
});

describe('GitHub link order', () => {
  it('puts pull requests first, work in progress before finished, then the newest', () => {
    const merged = link({ state: 'merged', updatedAt: '2026-11-25T00:00:00.000Z' });
    const issue = link({ kind: 'issue' });
    const older = link({ updatedAt: '2026-11-19T00:00:00.000Z' });
    const draft = link({ state: 'draft' });
    const newer = link({ updatedAt: '2026-11-24T00:00:00.000Z' });
    expect(sortGithubLinks([merged, issue, older, draft, newer])).toEqual([
      newer,
      older,
      draft,
      merged,
      issue,
    ]);
    expect(compareGithubLinks(newer, newer)).toBe(0);
  });

  it('gives each task its pull requests only, sorted', () => {
    const closed = link({ state: 'closed' });
    const open = link();
    const other = link({ taskId: 't2' });
    const issue = link({ kind: 'issue' });
    const byTask = pullRequestsByTask([closed, issue, open, other]);
    expect(byTask.get('t1')).toEqual([open, closed]);
    expect(byTask.get('t2')).toEqual([other]);
    expect(byTask.has('t3')).toBe(false);
  });
});

describe('a pasted GitHub address', () => {
  it('is no GitHub item when it is not an address of one', () => {
    expect(pastedGithubLink('THR-12', 'org/repo', [])).toBeNull();
    expect(pastedGithubLink('https://github.com/org/repo', 'org/repo', [])).toBeNull();
  });

  it('is offered from the connected repository, whatever its case or spacing', () => {
    expect(pastedGithubLink(' https://github.com/Org/Repo/pull/5 ', 'org/repo', [])).toEqual({
      repo: 'org/repo',
      kind: 'pr',
      number: 5,
      url: 'https://github.com/org/repo/pull/5',
      problem: null,
    });
  });

  it('says why it cannot be linked from another repository, or a second time', () => {
    expect(pastedGithubLink('https://github.com/a/b/issues/1', 'Org/Repo', [])?.problem).toBe(
      'This project follows Org/Repo.',
    );
    expect(
      pastedGithubLink('https://github.com/org/repo/issues/1', 'org/repo', [
        { repo: 'org/repo', kind: 'issue', number: 1 },
      ])?.problem,
    ).toBe('Already linked to this task.');
    // The same number as a pull request is another item.
    expect(
      pastedGithubLink('https://github.com/org/repo/pull/1', 'org/repo', [
        { repo: 'org/repo', kind: 'issue', number: 1 },
      ])?.problem,
    ).toBeNull();
  });
});

describe('linking and unlinking', () => {
  it('waits for the write to sync, and not for a no-op', async () => {
    fake.link.mockResolvedValueOnce({ txid: 12 });
    await linkGithub('t1', 'p', 'https://github.com/org/repo/pull/1');
    expect(fake.link).toHaveBeenCalledWith('t1', { url: 'https://github.com/org/repo/pull/1' });
    fake.unlink.mockResolvedValueOnce({ txid: null });
    await unlinkGithub('t1', 'l1');
    expect(fake.unlink).toHaveBeenCalledWith('t1', 'l1');
    expect(fake.awaited).toEqual([12]);
  });

  it('hides a link at once while it is removed, and shows it again when refused', async () => {
    const rows = [link(), link()];
    const hook = renderHook(() => useShownGithubLinks(rows));
    expect(hook.result.current).toBe(rows);
    let refuse: (error: unknown) => void = () => {};
    fake.unlink.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    const removing = unlinkGithub('t1', rows[0]!.id);
    await waitFor(() => expect(hook.result.current).toEqual([rows[1]]));
    refuse(new ApiError(500, 'down'));
    await expect(removing).rejects.toThrow('The link could not be removed.');
    await waitFor(() => expect(hook.result.current).toEqual(rows));
  });

  it('words refusals for the picker and the pane', async () => {
    fake.link.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    await expect(linkGithub('t1', 'p', 'x')).rejects.toThrow(
      new GithubLinkError('Only items from the connected repository can be linked.'),
    );
    fake.link.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(linkGithub('t1', 'p', 'x')).rejects.toThrow(/Could not reach the server/);
    fake.unlink.mockRejectedValueOnce(new ApiError(404, 'missing'));
    await expect(unlinkGithub('t1', 'l1')).rejects.toThrow('This server has no GitHub links.');
  });
});

describe('the connected repository', () => {
  it('is asked for once however many pickers want it', async () => {
    fake.connection.mockResolvedValueOnce({
      connection: { enabled: true, repository: 'org/repo' },
    });
    const first = renderHook(() => useGithubRepository('p1'));
    const second = renderHook(() => useGithubRepository('p1'));
    await waitFor(() => expect(first.result.current).toBe('org/repo'));
    expect(second.result.current).toBe('org/repo');
    expect(fake.connection).toHaveBeenCalledTimes(1);
  });

  it('is none while the connection is off, or on a server without the integration', async () => {
    fake.connection.mockResolvedValueOnce({ connection: { enabled: false, repository: 'a/b' } });
    const off = renderHook(() => useGithubRepository('p2'));
    fake.connection.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const older = renderHook(() => useGithubRepository('p3'));
    await waitFor(() => expect(fake.connection).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve));
    expect(off.result.current).toBeNull();
    expect(older.result.current).toBeNull();
  });

  it('is forgotten when linking finds the connection gone', async () => {
    fake.connection.mockResolvedValue({ connection: { enabled: true, repository: 'org/repo' } });
    const hook = renderHook(() => useGithubRepository('p4'));
    await waitFor(() => expect(hook.result.current).toBe('org/repo'));
    fake.link.mockRejectedValueOnce(new ApiError(409, 'gone'));
    await expect(linkGithub('t1', 'p4', 'x')).rejects.toBeInstanceOf(GithubLinkError);
    await waitFor(() => expect(hook.result.current).toBeNull());
  });
});
