import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TagBadge } from './TagBadge';

it('colors the leaf badge and lets touch reveal its full hierarchy without bubbling', async () => {
  const root: Tag = {
    id: 'root',
    workspaceId: 'workspace',
    projectId: 'project',
    name: 'Work',
    parentId: null,
    color: 'blue',
    icon: null,
  };
  const leaf: Tag = { ...root, id: 'leaf', name: 'Catch', parentId: root.id, color: null };
  const onCardClick = vi.fn();
  render(<TagBadge tag={leaf} tags={[root, leaf]} />, { wrapper: TooltipProvider });
  const badge = screen.getByRole('button', { name: 'Work / Catch' });
  expect(badge).toHaveAttribute('data-color', 'blue');
  expect(badge).toHaveTextContent('Catch');
  document.body.addEventListener('click', onCardClick);
  fireEvent.click(badge);
  document.body.removeEventListener('click', onCardClick);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Work / Catch');
  expect(onCardClick).not.toHaveBeenCalled();
  fireEvent.click(badge);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('keeps removal inside the badge as a separate action from revealing its hierarchy', async () => {
  const tag: Tag = {
    id: 'work',
    workspaceId: 'workspace',
    projectId: 'project',
    name: 'Work',
    parentId: null,
    color: 'blue',
    icon: null,
  };
  const onRemove = vi.fn();
  render(<TagBadge tag={tag} tags={[tag]} onRemove={onRemove} />, { wrapper: TooltipProvider });
  const label = screen.getByRole('button', { name: /^Work$/ });
  const remove = screen.getByRole('button', { name: 'Remove Work' });
  expect(label.closest('.glass')).toBe(remove.closest('.glass'));
  expect(remove.closest('button button')).toBeNull();
  fireEvent.click(label);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Work');
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(remove);
  expect(onRemove).toHaveBeenCalledOnce();
});
