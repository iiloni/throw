import { type Color, positionsBetween } from '@throw/shared';
import type { Category, Priority, Project, Status, Tag, Task } from './model';

/** In-memory data for the board prototype. Nothing here reaches a server. */

export type BoardData = { project: Project; tasks: Task[] };

const DAY = 86_400_000;

type StatusSeed = [name: string, category: Category, isDefault?: boolean];
type TagSeed = [name: string, color: Color, children?: string[]];
type TaskSeed = {
  title: string;
  status: string;
  priority?: Priority;
  tag?: string;
  also?: string[];
  /** Days since it was closed. */
  closed?: number;
  description?: string;
  subtasks?: [title: string, status: string][];
};

function build(
  project: Omit<Project, 'statuses' | 'tags'>,
  statusSeeds: StatusSeed[],
  tagSeeds: TagSeed[],
  taskSeeds: TaskSeed[],
): BoardData {
  const slug = (name: string) => `${project.id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const statuses: Status[] = statusSeeds.map(([name, category, isDefault]) => ({
    id: slug(name),
    name,
    category,
    isDefault: isDefault ?? false,
  }));
  const tags: Tag[] = tagSeeds.flatMap(([name, color, children = []]) => [
    { id: slug(name), name, parentId: null, color },
    ...children.map((child) => ({ id: slug(child), name: child, parentId: slug(name) })),
  ]);
  const count = taskSeeds.reduce((sum, seed) => sum + 1 + (seed.subtasks?.length ?? 0), 0);
  const positions = positionsBetween(null, null, count);
  const now = Date.now();
  const tasks: Task[] = [];
  let number = 0;
  const closedAt = (statusId: string, days?: number) => {
    const category = statuses.find((status) => status.id === statusId)?.category;
    return category === 'done' || category === 'cancelled' ? now - (days ?? 3) * DAY : null;
  };
  for (const seed of taskSeeds) {
    number += 1;
    const id = `${project.id}:task-${number}`;
    tasks.push({
      id,
      number,
      title: seed.title,
      statusId: slug(seed.status),
      priority: seed.priority ?? 2,
      position: positions[tasks.length]!,
      primaryTagId: seed.tag ? slug(seed.tag) : null,
      secondaryTagIds: (seed.also ?? []).map(slug),
      parentId: null,
      closedAt: closedAt(slug(seed.status), seed.closed),
      description: seed.description,
    });
    for (const [title, status] of seed.subtasks ?? []) {
      number += 1;
      tasks.push({
        id: `${project.id}:task-${number}`,
        number,
        title,
        statusId: slug(status),
        priority: seed.priority ?? 2,
        position: positions[tasks.length]!,
        primaryTagId: seed.tag ? slug(seed.tag) : null,
        secondaryTagIds: [],
        parentId: id,
        closedAt: closedAt(slug(status), 1),
      });
    }
  }
  return { project: { ...project, statuses, tags }, tasks };
}

const throwApp = () =>
  build(
    { id: 'throw', key: 'THR', name: 'Throw', color: 'mint', icon: 'target', priorityNames: [] },
    [
      ['Ideas', 'backlog'],
      ['Planned', 'backlog', true],
      ['Building', 'active', true],
      ['In review', 'active'],
      ['Testing', 'active'],
      ['Staging', 'active'],
      ['Releasing', 'active'],
      ['Shipped', 'done', true],
      ["Won't do", 'cancelled', true],
      ['Duplicate', 'cancelled'],
    ],
    [
      ['Board', 'teal', ['Drag', 'Cards']],
      ['Sync', 'blue', ['Outbox', 'Shapes']],
      ['Design', 'magenta', ['Motion']],
      ['Phone', 'orange'],
      ['Infra', 'amber', ['CI']],
      ['Docs', 'gray'],
    ],
    [
      {
        title: 'Outbox replays a status move twice after a 503',
        status: 'Building',
        priority: 0,
        tag: 'Outbox',
        also: ['Infra'],
        description:
          'A move queued offline is sent, the server applies it and the response is lost. The retry is answered with { txid: null }, but the optimistic row is dropped before Electric streams the first transaction back, so the card jumps to its old column for a moment.',
      },
      {
        title: "Priority zones: stretch the dragged card's zone",
        status: 'Building',
        priority: 1,
        tag: 'Drag',
        also: ['Motion'],
        description:
          'While a card is held over a column, its priority zone opens to take the column and the other four fold into rails at the top and bottom. Holding over a rail changes priority.',
        subtasks: [
          ['Fold other priorities into rails', 'Shipped'],
          ['Dwell before a rail takes the card', 'Shipped'],
          ['Auto-scroll the open zone', 'Building'],
          ['Land on a moving target when the zones unfold', 'Building'],
          ['Keyboard equivalent', 'Planned'],
        ],
      },
      {
        title: 'Card underlay for subtask progress',
        status: 'Building',
        priority: 1,
        tag: 'Cards',
        subtasks: [
          ['Tuck the strip under the card', 'Shipped'],
          ['Expand to list subtasks', 'In review'],
          ['Change a subtask status in place', 'Ideas'],
        ],
      },
      {
        title: 'Tasks table and shape with a membership filter',
        status: 'Building',
        priority: 1,
        tag: 'Shapes',
      },
      { title: 'Status dropzones in the phone dock', status: 'Building', tag: 'Phone' },
      { title: 'Long-press lift with a haptic tick', status: 'Building', tag: 'Phone' },
      {
        title: 'Split view: the task pane takes width from the board',
        status: 'Building',
        tag: 'Board',
      },
      {
        title:
          'When a card is held over a column whose priority zone is scrolled out of view, bring the zone to the card instead of making the user scroll while holding it',
        status: 'Building',
        tag: 'Drag',
        also: ['Phone', 'Motion'],
      },
      { title: 'Remember the backlog panel width per project', status: 'Building', tag: 'Board' },
      {
        title: 'Activity entries for refused offline changes',
        status: 'Building',
        tag: 'Sync',
        subtasks: [
          ['Record the wanted value', 'Building'],
          ['Show it in the timeline', 'Planned'],
        ],
      },
      {
        title: 'Reduced-motion pass over every board transition',
        status: 'Building',
        priority: 3,
        tag: 'Motion',
      },
      { title: 'Empty column state', status: 'Building', priority: 3, tag: 'Design' },
      {
        title: 'Move a card between columns from the keyboard',
        status: 'Building',
        priority: 3,
        tag: 'Board',
      },
      { title: 'Write the self-hosting guide', status: 'Building', priority: 3, tag: 'Docs' },
      {
        title: 'Easter egg: throw a card off the board',
        status: 'Building',
        priority: 4,
        tag: 'Motion',
      },

      {
        title: 'Server assigns task numbers in the create transaction',
        status: 'In review',
        priority: 1,
        tag: 'Sync',
      },
      { title: 'Jade focus ring on cards', status: 'In review', tag: 'Design' },
      {
        title: 'Status settings: reorder within a category',
        status: 'In review',
        tag: 'Board',
        subtasks: [
          ['Drag to reorder', 'Shipped'],
          ['Refuse deleting the last status', 'In review'],
        ],
      },
      { title: 'Docker E2E on pull requests', status: 'In review', priority: 3, tag: 'CI' },
      { title: 'Project key collisions offline', status: 'In review', priority: 3, tag: 'Sync' },

      {
        title: 'Electric shape for statuses',
        status: 'Testing',
        priority: 1,
        tag: 'Shapes',
      },
      { title: 'Dock clears the keyboard on Android', status: 'Testing', tag: 'Phone' },
      { title: 'Navigation rail remembers its width', status: 'Testing', tag: 'Design' },
      { title: 'Nightly backup of the dev database', status: 'Testing', priority: 4, tag: 'Infra' },

      {
        title: 'Cross-project board with priority bands',
        status: 'Planned',
        priority: 1,
        tag: 'Board',
        subtasks: [
          ['Category columns', 'Planned'],
          ['Color cards by project', 'Planned'],
          ['Masonry within a band', 'Ideas'],
        ],
      },
      { title: 'Command palette', status: 'Planned', priority: 1, tag: 'Design' },
      { title: 'Trash with restore', status: 'Planned', tag: 'Sync' },
      { title: 'Comments in the activity timeline', status: 'Planned', tag: 'Cards' },
      { title: 'Nested tag picker', status: 'Planned', tag: 'Cards' },
      { title: 'Android build from the same code', status: 'Planned', tag: 'Phone', also: ['CI'] },
      { title: 'Release channels', status: 'Planned', priority: 3, tag: 'Infra' },
      { title: 'Drag a subtask out to make it a task', status: 'Ideas', tag: 'Drag' },
      { title: 'Drop a card on another to make it a subtask', status: 'Ideas', tag: 'Drag' },
      { title: 'Promote a Catch note to a task', status: 'Ideas', priority: 3, tag: 'Sync' },
      { title: 'Milestones', status: 'Ideas', priority: 3, tag: 'Board' },
      { title: 'Cycle time from the activity log', status: 'Ideas', priority: 4, tag: 'Docs' },
      { title: 'Sound on drop?', status: 'Ideas', priority: 4, tag: 'Motion' },
      { title: 'Single sign-on with an OIDC provider', status: 'Ideas', priority: 4, tag: 'Infra' },

      { title: 'Responsive app shell', status: 'Shipped', tag: 'Design', closed: 1 },
      { title: 'Workspaces and projects sync', status: 'Shipped', tag: 'Sync', closed: 2 },
      { title: 'Throw artwork and jade palette', status: 'Shipped', tag: 'Design', closed: 2 },
      { title: 'Scaffold from Catch', status: 'Shipped', priority: 1, tag: 'Infra', closed: 6 },
      { title: 'Settle the task data model', status: 'Shipped', tag: 'Docs', closed: 4 },
      { title: 'List view', status: "Won't do", priority: 3, tag: 'Board', closed: 5 },
      { title: 'GitHub issue import', status: "Won't do", priority: 4, tag: 'Infra', closed: 9 },
      { title: 'Per-project accent color', status: 'Duplicate', tag: 'Design', closed: 7 },
      // Appended, so the numbers of the tasks above stay as they were.
      { title: 'Service worker update prompt', status: 'Staging', priority: 1, tag: 'Infra' },
      { title: 'Rail tooltip for project names', status: 'Staging', tag: 'Design' },
      { title: 'Keyboard move announcements', status: 'Staging', tag: 'Drag' },
      { title: 'Shape proxy column allowlist', status: 'Staging', priority: 3, tag: 'Shapes' },
      { title: 'Protocol version gate', status: 'Releasing', priority: 1, tag: 'Sync' },
      { title: 'Safe-area padding for the dock', status: 'Releasing', tag: 'Phone' },
      { title: 'Changelog for the first release', status: 'Releasing', priority: 3, tag: 'Docs' },
    ],
  );

const catchApp = () =>
  build(
    {
      id: 'catch',
      key: 'CAT',
      name: 'Catch',
      color: 'orange',
      icon: 'notebook',
      priorityNames: [],
    },
    [
      ['Inbox', 'backlog', true],
      ['Next', 'backlog'],
      ['Doing', 'active', true],
      ['Verify', 'active'],
      ['Released', 'done', true],
      ['Dropped', 'cancelled', true],
    ],
    [
      ['Editor', 'violet', ['Checklists']],
      ['Deck', 'green'],
      ['Search', 'cyan'],
      ['Android', 'lime'],
      ['Vault', 'red'],
    ],
    [
      {
        title: 'Semantic search falls back to keywords offline',
        status: 'Doing',
        priority: 1,
        tag: 'Search',
      },
      {
        title: 'Several servers on one Android install',
        status: 'Doing',
        tag: 'Android',
        subtasks: [
          ['Account switcher', 'Released'],
          ['Per-server local database', 'Doing'],
          ['Migrate the existing install', 'Next'],
        ],
      },
      { title: 'Checklist drag jitters on a long note', status: 'Doing', tag: 'Checklists' },
      { title: 'Deck columns remember scroll', status: 'Doing', priority: 3, tag: 'Deck' },
      { title: 'Vault unlock with a passkey', status: 'Verify', priority: 1, tag: 'Vault' },
      { title: 'Paste an image into a checklist item', status: 'Verify', tag: 'Editor' },
      { title: 'Search filters as chips', status: 'Next', priority: 1, tag: 'Search' },
      { title: 'Share a note read-only', status: 'Next', tag: 'Editor' },
      { title: 'Widget for the quick note', status: 'Next', tag: 'Android' },
      { title: 'Swipe a deck card to archive', status: 'Inbox', tag: 'Deck' },
      { title: 'Table blocks', status: 'Inbox', priority: 3, tag: 'Editor' },
      { title: 'Export a tag as Markdown', status: 'Inbox', priority: 4, tag: 'Editor' },
      { title: 'Reminders snooze picker', status: 'Released', tag: 'Deck', closed: 1 },
      { title: 'Link previews under cards', status: 'Released', tag: 'Deck', closed: 3 },
      { title: 'Voice notes', status: 'Dropped', priority: 3, tag: 'Android', closed: 8 },
    ],
  );

const flatMove = () =>
  build(
    {
      id: 'move',
      key: 'MOVE',
      name: 'Flat move',
      color: 'pink',
      icon: 'house',
      priorityNames: ['Today', 'This week', null, 'After the move', 'Maybe'],
    },
    [
      ['Someday', 'backlog'],
      ['To do', 'backlog', true],
      ['Doing', 'active', true],
      ['Waiting on someone', 'active'],
      ['Done', 'done', true],
      ['Skipped', 'cancelled', true],
    ],
    [
      ['Paperwork', 'dark-blue'],
      ['Packing', 'brown'],
      ['New place', 'green', ['Kitchen']],
      ['Money', 'yellow'],
    ],
    [
      { title: 'Sign the lease addendum', status: 'Doing', priority: 0, tag: 'Paperwork' },
      {
        title: 'Book the movers',
        status: 'Waiting on someone',
        priority: 1,
        tag: 'Packing',
        subtasks: [
          ['Get three quotes', 'Done'],
          ['Confirm the lift is booked', 'Waiting on someone'],
        ],
      },
      { title: 'Pack the books', status: 'Doing', tag: 'Packing' },
      { title: 'Transfer the internet contract', status: 'Waiting on someone', tag: 'Paperwork' },
      { title: 'Measure the kitchen for shelves', status: 'To do', priority: 1, tag: 'Kitchen' },
      { title: 'Change address at the bank', status: 'To do', tag: 'Money' },
      { title: 'Sell the old sofa', status: 'To do', priority: 3, tag: 'Money' },
      { title: 'Paint the hallway', status: 'Someday', priority: 3, tag: 'New place' },
      { title: 'Balcony herbs', status: 'Someday', priority: 4, tag: 'New place' },
      { title: 'Deposit paid', status: 'Done', tag: 'Money', closed: 2 },
      { title: 'Give notice on the old flat', status: 'Done', tag: 'Paperwork', closed: 12 },
      { title: 'Hire a van ourselves', status: 'Skipped', tag: 'Packing', closed: 6 },
    ],
  );

export function mockBoards(): BoardData[] {
  return [throwApp(), catchApp(), flatMove()];
}
