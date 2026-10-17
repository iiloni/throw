import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Description, Task } from '@throw/shared';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { readDescriptionDraft, settleDescriptionDraft } from '@/lib/descriptionDrafts';
import { flushTaskDescription } from '@/lib/descriptionEditing';
import { TaskDescription } from './TaskDescription';

const fake = vi.hoisted(() => ({ task: undefined as Task | undefined, save: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user' }) }));
vi.mock('@/lib/serverUrl', () => ({ getServerUrl: () => 'https://throw.example' }));
vi.mock('@/lib/tasks', () => ({ getTask: () => fake.task, saveDescription: fake.save }));
vi.mock('@/components/DescriptionEditor/LazyDescriptionEditor', () => ({
  // BlockNote owns its mounted content, so this detects unwanted caret-destroying remounts.
  LazyDescriptionEditor: function Editor({
    initialContent,
    editable,
    onChange,
  }: {
    initialContent: Description;
    editable?: boolean;
    onChange?: (document: Description) => void;
  }) {
    const [value, setValue] = useState(JSON.stringify(initialContent));
    return (
      <textarea
        aria-label={editable ? 'Draft text' : 'Saved text'}
        readOnly={!editable}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.([{ type: 'paragraph', content: event.target.value }]);
        }}
      />
    );
  },
}));
const row: Task = {
  id: 'task',
  workspaceId: 'workspace',
  projectId: 'project',
  title: 'Title',
  number: 1,
  description: [{ type: 'paragraph', content: 'Initial' }],
  descriptionVersion: 'base',
  statusId: 'status',
  priority: 3,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T00:00:00Z',
};
beforeEach(() => {
  localStorage.clear();
  fake.task = { ...row };
  fake.save.mockReset();
  fake.save.mockImplementation((_id: string, document: Description) => {
    fake.task = { ...fake.task!, description: document, descriptionVersion: 'new' };
    return { version: 'new', transaction: { isPersisted: { promise: new Promise(() => {}) } } };
  });
});

it('starts editable without buttons and follows a remote revision before typing', () => {
  const view = render(<TaskDescription task={row} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(
    <TaskDescription
      task={{ ...row, descriptionVersion: 'remote', description: [{ content: 'Remote text' }] }}
    />,
  );
  expect(screen.getByLabelText('Draft text')).toHaveValue('[{"content":"Remote text"}]');
  view.unmount();
  expect(fake.save).not.toHaveBeenCalled();
});

it('stores typing locally, then queues one save with its captured version when leaving', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'My draft' } });
  expect(fake.save).not.toHaveBeenCalled();
  act(() => {
    expect(flushTaskDescription('task')).toBe(true);
  });
  view.unmount();
  expect(fake.save).toHaveBeenCalledTimes(1);
  expect(fake.save).toHaveBeenCalledWith(
    'task',
    [{ type: 'paragraph', content: 'My draft' }],
    'base',
  );
  expect(readDescriptionDraft('task')).toMatchObject({
    status: 'pending',
    submittedVersion: 'new',
  });
  render(<TaskDescription task={fake.task!} />);
  expect(screen.getByLabelText('Draft text')).toHaveValue(
    '[{"type":"paragraph","content":"My draft"}]',
  );
});

it('resumes from the queued save when a flushed editor stays mounted', () => {
  render(<TaskDescription task={row} />);
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'First pass' } });
  act(() => {
    expect(flushTaskDescription('task')).toBe(true);
  });
  // A parent pane stays beneath its subtask, so its editor is still there to type in.
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'Second pass' } });
  act(() => {
    expect(flushTaskDescription('task')).toBe(true);
  });
  expect(fake.save).toHaveBeenLastCalledWith(
    'task',
    [{ type: 'paragraph', content: 'Second pass' }],
    'new',
  );
});

it('flushes on route unmount as well as the board close path', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.change(screen.getByLabelText('Draft text'), {
    target: { value: 'Leave through navigation' },
  });
  view.unmount();
  expect(fake.save).toHaveBeenCalledWith(
    'task',
    [{ type: 'paragraph', content: 'Leave through navigation' }],
    'base',
  );
});

it('preserves mounted draft text during remote edits and guards against an unreviewed replacement', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'Keep my selection' } });
  const remote = { ...row, descriptionVersion: 'remote', description: [{ content: 'Remote' }] };
  fake.task = remote;
  view.rerender(<TaskDescription task={remote} />);
  expect(screen.getByLabelText('Draft text')).toHaveValue('Keep my selection');
  fireEvent.click(screen.getByRole('button', { name: 'Review latest description' }));
  fake.task = { ...remote, descriptionVersion: 'another' };
  fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }));
  expect(fake.save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('changed again');
});

it('can keep a reviewed draft for the next close, or use the latest after a refusal', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'My version' } });
  const remote = { ...row, descriptionVersion: 'remote' };
  fake.task = remote;
  view.rerender(<TaskDescription task={remote} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review latest description' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }));
  expect(fake.save).not.toHaveBeenCalled();
  act(() => {
    flushTaskDescription('task');
  });
  expect(fake.save).toHaveBeenCalledWith(
    'task',
    [{ type: 'paragraph', content: 'My version' }],
    'remote',
  );
  act(() =>
    settleDescriptionDraft('task', { version: 'new', document: [{ content: 'My version' }] }, true),
  );
  expect(screen.getByRole('status')).toHaveTextContent('not applied');
  fireEvent.click(screen.getByRole('button', { name: 'Review latest description' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use latest description' }));
  expect(readDescriptionDraft('task')).toBeNull();
});

it('keeps the task open if the latest text cannot be stored and retries that exact text', () => {
  render(<TaskDescription task={row} />);
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  fireEvent.change(screen.getByLabelText('Draft text'), {
    target: { value: 'Text still in the editor' },
  });
  act(() => {
    expect(flushTaskDescription('task')).toBe(false);
  });
  expect(screen.getByLabelText('Draft text')).toHaveValue('Text still in the editor');
  expect(fake.save).not.toHaveBeenCalled();
  storage.mockRestore();
  act(() => {
    expect(flushTaskDescription('task')).toBe(true);
  });
  expect(fake.save).toHaveBeenCalledWith(
    'task',
    [{ type: 'paragraph', content: 'Text still in the editor' }],
    'base',
  );
});
