import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Comment } from '@throw/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommentList, CommentPrompt } from './Comments';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const fake = vi.hoisted(() => ({
  deleteComment: vi.fn(),
  editComment: vi.fn(),
}));

vi.mock('@/lib/collections', () => ({ signedInUserId: 'me' }));
vi.mock('@/lib/comments', () => ({
  deleteComment: fake.deleteComment,
  editComment: fake.editComment,
}));
vi.mock('@/lib/haptics', () => ({ haptics: { warning: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/commentDrafts', () => ({
  readCommentDraft: () => null,
  storeCommentDraft: vi.fn(),
}));
vi.mock('@/components/DescriptionEditor/LazyDescriptionEditor', () => ({
  LazyDescriptionEditor: ({
    initialContent,
    editable,
  }: {
    initialContent: { content: { text: string }[] }[] | null;
    editable?: boolean;
  }) => {
    const text = initialContent?.[0]?.content[0]?.text ?? '';
    return editable ? <div contentEditable data-testid="editor" /> : <p>{text}</p>;
  },
}));

const body = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
const comment = (fields: Partial<Comment> = {}): Comment => ({
  id: '018f0000-0000-7000-8000-000000000001',
  workspaceId: '018f0000-0000-7000-8000-000000000002',
  projectId: '018f0000-0000-7000-8000-000000000003',
  taskId: '018f0000-0000-7000-8000-000000000004',
  userId: 'me',
  viaTokenName: null,
  body: body('Ready for review'),
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  editedAt: null,
  ...fields,
});
const list = (comments: Comment[], pending = false) =>
  comments.map((item) => ({ type: 'comment' as const, id: item.id, comment: item, pending }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});

it('names the author, the token an agent used and how long ago it synced', () => {
  render(
    <CommentList
      loading={false}
      comments={list([
        comment({ viaTokenName: 'Release agent' }),
        comment({ id: '018f0000-0000-7000-8000-000000000009', userId: 'someone' }),
      ])}
    />,
  );
  const own = screen.getByRole('article', { name: 'You commented' });
  expect(own).toHaveTextContent('via Release agent');
  expect(within(own).getByText(/5/, { selector: 'time' })).toBeInTheDocument();
  expect(within(own).getByRole('button', { name: 'Edit comment' })).toBeInTheDocument();
  // Only the author edits or deletes.
  const other = screen.getByRole('article', { name: 'Another member commented' });
  expect(within(other).queryAllByRole('button')).toHaveLength(0);
});

it('marks a comment the server has not dated yet', () => {
  render(<CommentList loading={false} comments={list([comment({ createdAt: null })], true)} />);
  expect(screen.getByRole('article', { name: 'You commented' })).toHaveTextContent('Pending sync');
});

it('asks before deleting, and keeps the comment when told to', () => {
  render(<CommentList loading={false} comments={list([comment()])} />);
  const own = screen.getByRole('article', { name: 'You commented' });
  fireEvent.click(within(own).getByRole('button', { name: 'Delete comment' }));
  // The toolbar's own delete gives way to the confirmation's.
  expect(within(own).getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1);
  fireEvent.click(within(own).getByRole('button', { name: 'Keep comment' }));
  expect(fake.deleteComment).not.toHaveBeenCalled();
});

it('deletes once confirmed', () => {
  render(<CommentList loading={false} comments={list([comment()])} />);
  const own = screen.getByRole('article', { name: 'You commented' });
  fireEvent.click(within(own).getByRole('button', { name: 'Delete comment' }));
  fireEvent.click(within(own).getByRole('button', { name: 'Delete comment' }));
  expect(fake.deleteComment).toHaveBeenCalledWith(comment().id);
});

it('edits on the comment’s own card, and cancelling brings the text back', async () => {
  render(<CommentList loading={false} comments={list([comment()])} />);
  const own = screen.getByRole('article', { name: 'You commented' });
  fireEvent.click(within(own).getByRole('button', { name: 'Edit comment' }));
  expect(within(own).getByRole('region', { name: 'Comment editor' })).toBeInTheDocument();
  expect(within(own).queryByRole('button', { name: 'Edit comment' })).toBeNull();
  expect(within(own).getByRole('button', { name: 'Save' })).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+Enter Meta+Enter',
  );
  await act(async () => {
    fireEvent.click(within(own).getByRole('button', { name: 'Cancel' }));
  });
  expect(within(own).queryByRole('region', { name: 'Comment editor' })).toBeNull();
  expect(own).toHaveTextContent('Ready for review');
});

it('offers to resume a draft, and opens the composer in its place', () => {
  const onCompose = vi.fn();
  const { rerender } = render(
    <CommentPrompt composing={false} hasDraft onCompose={onCompose} composer={<p>Composer</p>} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resume comment draft' }));
  expect(onCompose).toHaveBeenCalled();
  rerender(<CommentPrompt composing hasDraft onCompose={onCompose} composer={<p>Composer</p>} />);
  expect(screen.getByText('Composer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume comment draft' })).toBeNull();
});
