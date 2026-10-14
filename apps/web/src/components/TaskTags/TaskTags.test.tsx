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
