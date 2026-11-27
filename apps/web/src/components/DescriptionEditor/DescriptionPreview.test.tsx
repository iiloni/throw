import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { buildReferenceIndex } from '@/components/TaskReferences/referenceIndex';
import {
  TaskReferenceIndexContext,
  TaskReferenceScope,
} from '@/components/TaskReferences/TaskReferences';
import { DescriptionPreview } from './DescriptionPreview';

vi.mock('@/lib/collections', () => ({}));

it('paints text and formatting from a BlockNote draft without loading the editor', () => {
  render(
    <DescriptionPreview
      document={[
        { type: 'paragraph', content: [{ type: 'text', text: 'A draft', styles: { bold: true } }] },
        {
          type: 'bulletListItem',
          content: 'A step',
          children: [{ type: 'paragraph', content: 'Nested detail' }],
        },
      ]}
    />,
  );
  expect(screen.getByText('A draft')).toHaveClass('font-bold');
  expect(screen.getByText('A step')).toBeVisible();
  expect(screen.getByText('Nested detail')).toBeVisible();
});
it('keeps links inert and drops media from the transition preview', () => {
  render(
    <DescriptionPreview
      document={[
        {
          type: 'paragraph',
          content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ text: 'A link' }] }],
        },
        { type: 'image', props: { url: 'https://example.com/file.jpg' } },
      ]}
    />,
  );
  expect(screen.getByText('A link')).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});
it('draws resolved task references and leaves code, links and unknown keys as text', () => {
  const index = buildReferenceIndex({
    projects: [
      {
        id: 'app',
        workspaceId: 'workspace',
        name: 'App',
        color: 'teal',
        icon: null,
        position: 'a0',
        key: 'THR',
        priorityNames: ['', '', '', '', ''],
        deletedAt: null,
      },
    ],
    statuses: [],
    tasks: [1, 2].map((number) => ({
      id: `task-${number}`,
      workspaceId: 'workspace',
      projectId: 'app',
      number,
      title: `Task ${number}`,
      description: null,
      descriptionVersion: null,
      statusId: 'open',
      priority: 3 as const,
      size: null,
      position: 'a0',
      parentId: null,
      primaryTagId: null,
      closedAt: null,
      deletedAt: null,
      createdAt: '2026-11-22T00:00:00.000Z',
    })),
    tags: [],
    taskTags: [],
    relations: [],
  });
  const { container } = render(
    <TaskReferenceIndexContext.Provider value={index}>
      <TaskReferenceScope taskId="task-1">
        <DescriptionPreview
          document={[
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'See #thr-2, not #THR-9 or ', styles: {} },
                { type: 'text', text: '#THR-2', styles: { code: true } },
                { type: 'link', href: 'https://example.com', content: [{ text: '#THR-2' }] },
              ],
            },
            { type: 'codeBlock', content: [{ type: 'text', text: '#THR-2', styles: {} }] },
          ]}
        />
      </TaskReferenceScope>
    </TaskReferenceIndexContext.Provider>,
  );
  const references = [...container.querySelectorAll('[data-task-ref]')];
  expect(
    references.map((element) => [element.textContent, element.getAttribute('data-task-ref')]),
  ).toEqual([['#thr-2', 'THR-2']]);
});
