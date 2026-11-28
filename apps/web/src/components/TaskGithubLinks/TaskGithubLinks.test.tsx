import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaskGithubLink } from '@throw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubPullMark, pullMarkLabel } from './GithubPullMark';
import { TaskGithubLinks } from './TaskGithubLinks';

const fake = vi.hoisted(() => ({
  unlink: vi.fn(async () => {}),
  toast: vi.fn(),
  hovers: true,
}));
vi.mock('sonner', () => ({ toast: fake.toast }));
vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn() } }));
vi.mock('@/lib/githubLinks', async (original) => ({
  ...(await original<typeof import('@/lib/githubLinks')>()),
  unlinkGithub: fake.unlink,
}));

let next = 0;
function link(extra: Partial<TaskGithubLink> = {}): TaskGithubLink {
  next += 1;
  const number = extra.number ?? next;
  return {
    id: `0199a0a0-0000-7000-8000-${String(next).padStart(12, '0')}`,
    workspaceId: 'w',
    projectId: 'p',
    taskId: 't1',
    repo: 'org/repo',
    kind: 'pr',
    number,
    url: `https://github.com/org/repo/${extra.kind === 'issue' ? 'issues' : 'pull'}/${number}`,
    title: `Item ${number}`,
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

beforeEach(() => {
  fake.hovers = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('hover') ? fake.hovers : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the task pane’s GitHub links', () => {
  it('groups pull requests and issues, each opening GitHub in a new tab', () => {
    render(
      <TaskGithubLinks
        links={[
          link({
            number: 12,
            title: 'Speed up sync',
            branch: 'feat/sync',
            reviewDecision: 'approved',
            checksSummary: { state: 'failing', failed: 1, pending: 2, passed: 3 },
          }),
          link({ kind: 'issue', number: 4, title: 'Crash on launch', state: 'closed' }),
        ]}
      />,
    );
    const section = screen.getByRole('region', { name: 'GitHub' });
    expect(
      within(section)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Pull requests', 'Issues']);
    const pull = within(section).getByRole('link', { name: /^Pull request org\/repo#12/ });
    expect(pull).toHaveAttribute('href', 'https://github.com/org/repo/pull/12');
    expect(pull).toHaveAttribute('target', '_blank');
    expect(pull).toHaveAttribute('rel', 'noopener noreferrer');
    expect(pull).toHaveTextContent('Speed up sync');
    expect(pull).toHaveTextContent('Approved');
    expect(pull).toHaveTextContent('feat/sync');
    expect(
      within(pull).getByRole('img', { name: 'Checks: 1 failed, 2 pending, 3 passed' }),
    ).toBeInTheDocument();
    const issue = within(section).getByRole('link', { name: /^Issue org\/repo#4/ });
    expect(issue).toHaveTextContent('Closed');
    expect(issue.querySelector('[data-github-state="closed"]')).toHaveAttribute(
      'data-color',
      'violet',
    );
    // An issue has no review or checks to show.
    expect(issue.querySelector('[data-github-review]')).toBeNull();
  });

  it('shows nothing without links', () => {
    const { container } = render(<TaskGithubLinks links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('removes a link, and says so when it could not', async () => {
    const pull = link({ number: 7 });
    render(<TaskGithubLinks links={[pull]} />);
    const remove = screen.getByRole('button', { name: 'Remove pull request org/repo#7' });
    fireEvent.click(remove);
    expect(fake.unlink).toHaveBeenCalledWith('t1', pull.id);
    const { GithubLinkError } = await import('@/lib/githubLinks');
    fake.unlink.mockRejectedValueOnce(new GithubLinkError('Not now.'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove pull request org/repo#7' }));
    await waitFor(() => expect(fake.toast).toHaveBeenCalledWith('Not now.'));
  });
});

describe('a card’s pull request mark', () => {
  it('names its most relevant pull request and counts the others', () => {
    const failing = link({
      number: 9,
      checksSummary: { state: 'failing', failed: 1, pending: 0, passed: 0 },
    });
    expect(pullMarkLabel([failing])).toBe('Pull request #9, open, checks failing');
    expect(pullMarkLabel([failing, link({ state: 'merged' })])).toBe(
      '2 pull requests, first pull request #9, open, checks failing',
    );
    render(<GithubPullMark pulls={[failing, link({ number: 3, state: 'merged' })]} interactive />);
    const mark = screen.getByRole('link', { name: /^2 pull requests/ });
    expect(mark).toHaveTextContent('#9+1');
    expect(mark).toHaveAttribute('href', 'https://github.com/org/repo/pull/9');
    expect(mark).toHaveAttribute('data-color', 'red');
    // It takes no part in the card's press: no drag, no opening the task.
    expect(mark).toHaveAttribute('data-no-drag');
  });

  it('is a quiet mark alone on a touch screen and on a card’s copy', () => {
    fake.hovers = false;
    const { rerender } = render(<GithubPullMark pulls={[link({ number: 5 })]} interactive />);
    expect(screen.getByRole('img', { name: 'Pull request #5, open' })).toHaveTextContent('#5');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fake.hovers = true;
    rerender(<GithubPullMark pulls={[link({ number: 6, state: 'draft' })]} interactive={false} />);
    expect(screen.getByRole('img', { name: 'Pull request #6, draft' })).toHaveAttribute(
      'data-color',
      'gray',
    );
  });

  it('previews every pull request on focus', async () => {
    render(
      <GithubPullMark
        pulls={[
          link({ number: 1, title: 'First', reviewDecision: 'changes_requested' }),
          link({ number: 2, title: 'Second', state: 'closed' }),
        ]}
        interactive
      />,
    );
    fireEvent.focus(screen.getByRole('link', { name: /^2 pull requests/ }));
    const preview = await waitFor(() => {
      const element = document.querySelector('[data-github-preview]');
      if (!element) throw new Error('No preview yet');
      return element as HTMLElement;
    });
    expect(preview).toHaveTextContent('First');
    expect(preview).toHaveTextContent('Changes requested');
    expect(preview).toHaveTextContent('Second');
    expect(
      within(preview).getByRole('link', { name: /^Pull request org\/repo#2: Second, Closed/ }),
    ).toHaveAttribute('href', 'https://github.com/org/repo/pull/2');
  });
});
