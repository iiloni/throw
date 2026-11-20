import { render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { expect, it } from 'vitest';
import { TaskTags } from './TaskTags';

const tag: Tag = {
  id: 'tag',
  workspaceId: 'workspace',
  projectId: 'project',
  name: 'Mobile',
  parentId: null,
  color: 'teal',
  icon: null,
};
it('renders primary first and shows shared roles once without losing other secondary tags', () => {
  render(
    <TaskTags
      tags={[tag, { ...tag, id: 'other', name: 'Design' }]}
      primaryTagId={tag.id}
      secondaryTagIds={['other', tag.id, 'missing', 'other']}
      interactive={false}
    />,
  );
  const chips = screen.getByRole('region', { name: 'Task tags' });
  expect(chips.textContent).toBe('MobileDesign');
  expect(screen.getAllByText('Mobile')).toHaveLength(1);
});
it('renders nothing when assigned rows have not synced or no tags were selected', () => {
  const { container } = render(<TaskTags tags={[]} primaryTagId="missing" secondaryTagIds={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it('on a card, shows a few badges with a count of the rest, without a landmark of its own', () => {
  const tags = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ ...tag, id: name, name }));
  const { container } = render(
    <TaskTags tags={tags} primaryTagId="A" secondaryTagIds={['B', 'C', 'D', 'E']} card />,
  );
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(container.textContent).toBe('ABC+2');
  expect(screen.getByText('+2')).toHaveAccessibleDescription('D, E');
});

it('leaves tag colors out where they would mislead', () => {
  const { container, rerender } = render(
    <TaskTags tags={[tag]} primaryTagId={tag.id} secondaryTagIds={[]} card />,
  );
  expect(container.querySelector('[data-color="teal"]')).not.toBeNull();
  rerender(
    <TaskTags tags={[tag]} primaryTagId={tag.id} secondaryTagIds={[]} card colored={false} />,
  );
  expect(container.querySelector('[data-color]')).toBeNull();
});
