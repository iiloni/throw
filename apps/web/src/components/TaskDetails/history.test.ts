import type { ActivityChange, ActivityEntry } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { changeSentence, entrySentences, hasCommentText } from './history';

const context = {
  priorityNames: ['Urgent', '', '', '', 'Someday'],
  parentName: (id: string) => (id === 'parent' ? 'TASK-2' : undefined),
};
const change = (
  field: ActivityChange['field'],
  previous: unknown,
  requested: unknown,
  extra: Partial<ActivityChange> = {},
): ActivityChange => ({ field, previous, requested, applied: true, ...extra });
const entry = (
  changes: ActivityChange[],
  kind: ActivityEntry['kind'] = 'updated',
): ActivityEntry => ({
  id: 'update',
  workspaceId: 'workspace',
  projectId: 'project',
  taskId: 'task',
  userId: 'user',
  createdAt: '2026-10-19T12:00:00.000Z',
  changes,
  kind,
});

describe('history sentences', () => {
  it.each([
    [change('title', 'Before', 'After'), 'Renamed from “Before” to “After”.'],
    [change('title', '', 'After'), 'Renamed from “Untitled” to “After”.'],
    [
      change('statusId', 'gone', 'also-gone', { previousName: 'Testing', requestedName: 'Done' }),
      'Changed status from “Testing” to “Done”.',
    ],
    [change('priority', 3, 1), 'Changed priority from “Default” to “Urgent”.'],
    [change('parentId', null, 'parent'), 'Moved under TASK-2.'],
    [change('parentId', 'parent', null), 'Removed parent TASK-2.'],
    [change('parentId', null, 'gone'), 'Moved under an unavailable parent.'],
    [
      change('primaryTagId', null, 'tag', { requestedName: 'Launch' }),
      'Set primary tag to “Launch”.',
    ],
    [
      change('primaryTagId', 'tag', null, { previousName: 'Launch' }),
      'Removed primary tag “Launch”.',
    ],
    [change('secondaryTags', null, 'tag', { requestedName: 'Press' }), 'Added tag “Press”.'],
    [change('secondaryTags', 'tag', null, { previousName: 'Press' }), 'Removed tag “Press”.'],
    [change('trashed', false, true), 'Moved to the trash.'],
    [change('trashed', true, false), 'Restored from the trash.'],
    [change('description', 'v1', 'v2'), 'Changed the description.'],
  ])('words %j', (item, expected) => expect(changeSentence(item, context)).toBe(expected));

  it('does not claim a change happened when another write already set the wanted value', () => {
    expect(changeSentence(change('title', 'Same', 'Same'), context)).toBe(
      'Title was already “Same”.',
    );
    expect(changeSentence(change('priority', 3, 3), context)).toBe(
      'Priority was already “Default”.',
    );
    expect(changeSentence(change('parentId', null, null), context)).toBe(
      'The task already had no parent.',
    );
    expect(changeSentence(change('trashed', true, true), context)).toBe(
      'The task was already in the trash.',
    );
    expect(changeSentence(change('description', 'v1', 'v1'), context)).toBe(
      'The description was already up to date.',
    );
  });

  it('states the requested value, the value that stood, and the refusal reason', () => {
    expect(
      changeSentence(
        change('title', 'Server', 'Offline', { applied: false, reason: 'stale' }),
        context,
      ),
    ).toBe(
      'Title not applied: wanted “Offline”; kept “Server” because it changed before this update synced.',
    );
    expect(
      changeSentence(
        change('statusId', 'kept', 'gone', {
          previousName: 'Testing',
          applied: false,
          reason: 'invalid',
        }),
        context,
      ),
    ).toBe(
      'Status not applied: wanted an unavailable status; kept “Testing” because the requested value was no longer valid.',
    );
    const refusedDescription = change('description', 'v1', 'v2', {
      applied: false,
      reason: 'stale',
      rejectedDocument: [{ content: 'SECRET' }],
    });
    expect(changeSentence(refusedDescription, context)).toContain('kept the existing description');
    expect(changeSentence(refusedDescription, context)).not.toMatch(/SECRET|v1|v2/);
  });

  it('condenses creation and records a replaced status and rejected initial tags', () => {
    expect(
      entrySentences(
        entry(
          [
            change('title', null, 'Plan'),
            change('statusId', null, 'backlog', { requestedName: 'Backlog', reason: 'replaced' }),
            change('priority', null, 3),
            change('secondaryTags', null, 'gone', { applied: false, reason: 'invalid' }),
          ],
          'created',
        ),
        context,
      ),
    ).toEqual([
      'Created the task “Plan” in “Backlog”.',
      'The requested status was unavailable. Used “Backlog”.',
      'Tag not applied: wanted an unavailable tag; kept no tag because the requested value was no longer valid.',
    ]);
  });

  it('keeps all fields of a write together without hiding a mixed refusal', () => {
    expect(
      entrySentences(
        entry([
          change('priority', 3, 5),
          change('title', 'Server', 'Offline', { applied: false, reason: 'stale' }),
        ]),
        context,
      ),
    ).toHaveLength(2);
    expect(changeSentence(change('future' as 'title', null, 'x'), context)).toBe(
      'Changed a task field.',
    );
  });
});

it('rejects empty editor scaffolding but accepts text in nested lists, links and tables', () => {
  expect(hasCommentText(null)).toBe(false);
  expect(
    hasCommentText([
      {
        id: 'not-content',
        type: 'paragraph',
        props: { color: 'red' },
        content: [{ type: 'text', text: '  ' }],
      },
    ]),
  ).toBe(false);
  for (const content of [
    [{ content: [{ type: 'link', content: [{ text: 'Link' }] }] }],
    [{ children: [{ content: [{ text: 'Nested' }] }] }],
    [{ content: { rows: [{ cells: [{ content: [{ text: 'Cell' }] }] }] } }],
  ])
    expect(hasCommentText(content)).toBe(true);
});
