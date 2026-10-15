import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Description, Task } from '@throw/shared';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { readDescriptionDraft, settleDescriptionDraft } from '@/lib/descriptionDrafts';
import { TaskDescription } from './TaskDescription';

const fake = vi.hoisted(() => ({ task: undefined as Task | undefined, save: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user' }) }));
vi.mock('@/lib/serverUrl', () => ({ getServerUrl: () => 'https://throw.example' }));
vi.mock('@/lib/tasks', () => ({ getTask: () => fake.task, saveDescription: fake.save }));
vi.mock('@/components/DescriptionEditor/LazyDescriptionEditor', () => ({
  // Like BlockNote, this reads initial content once, allowing tests to detect accidental
  // remounts that would replace the text and selection during an edit.
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
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T00:00:00Z',
};
beforeEach(() => {
  localStorage.clear();
  fake.task = { ...row };
  fake.save.mockReset();
  fake.save.mockReturnValue({
    version: 'new',
    transaction: { isPersisted: { promise: new Promise(() => {}) } },
  });
});

it('updates a read-only description when a remote version arrives', () => {
  const view = render(<TaskDescription task={row} />);
  view.rerender(
    <TaskDescription
      task={{ ...row, descriptionVersion: 'remote', description: [{ content: 'Remote text' }] }}
    />,
  );
  expect(screen.getByLabelText('Saved text')).toHaveValue('[{"content":"Remote text"}]');
});

it('keeps a draft on close and reopens it with the version it was based on', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'My draft' } });
  view.unmount();
  render(<TaskDescription task={row} />);
  expect(screen.getByLabelText('Draft text')).toHaveValue(
    '[{"type":"paragraph","content":"My draft"}]',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save description' }));
  expect(fake.save).toHaveBeenCalledWith(
    'task',
    [{ type: 'paragraph', content: 'My draft' }],
    'base',
  );
  expect(readDescriptionDraft('task')).toMatchObject({
    status: 'pending',
    submittedVersion: 'new',
  });
});

it('preserves the mounted draft during remote edits and guards replacement against another unseen change', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'Keep my selection' } });
  const remote = { ...row, descriptionVersion: 'remote', description: [{ content: 'Remote' }] };
  fake.task = remote;
  view.rerender(<TaskDescription task={remote} />);
  expect(screen.getByLabelText('Draft text')).toHaveValue('Keep my selection');
  expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review latest description' }));
  fake.task = { ...remote, descriptionVersion: 'another' };
  fireEvent.click(screen.getByRole('button', { name: 'Apply my version' }));
  expect(fake.save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('changed again');
});

it('lets the user explicitly replace a reviewed version or discard their draft', () => {
  const view = render(<TaskDescription task={row} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'My version' } });
  const remote = { ...row, descriptionVersion: 'remote' };
  fake.task = remote;
  view.rerender(<TaskDescription task={remote} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review latest description' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply my version' }));
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

it('does not save an older draft when the device cannot store the latest keystrokes', () => {
  render(<TaskDescription task={row} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  fireEvent.change(screen.getByLabelText('Draft text'), {
    target: { value: 'Text still in the editor' },
  });
  expect(screen.getByLabelText('Draft text')).toHaveValue('Text still in the editor');
  expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('copy your text');
  expect(fake.save).not.toHaveBeenCalled();
  storage.mockRestore();
});
