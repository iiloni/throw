import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { closeNewTag, NewTagButton, newTagHosted, newTagRequest, openNewTag } from './NewTag';

it('shows the button only while a host can show the form', () => {
  const onClick = vi.fn();
  render(<NewTagButton onClick={onClick} />);
  expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
  act(() => newTagHosted.set(true));
  fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
  expect(onClick).toHaveBeenCalledOnce();
  act(() => newTagHosted.set(false));
});

it('closes one request before opening the next, and closes once', () => {
  const first = { projectId: 'project', parentId: null, onCreated: vi.fn(), onClose: vi.fn() };
  const second = { ...first, parentId: 'root', onClose: vi.fn() };
  openNewTag(first);
  openNewTag(second);
  expect(first.onClose).toHaveBeenCalledOnce();
  expect(newTagRequest.get()).toMatchObject({ parentId: 'root' });
  closeNewTag();
  closeNewTag();
  expect(second.onClose).toHaveBeenCalledOnce();
  expect(newTagRequest.get()).toBeNull();
});
