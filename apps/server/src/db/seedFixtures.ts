import {
  type ActivityChange,
  type Color,
  type CommentBody,
  type Description,
  isClosedCategory,
  type Priority,
  positionsBetween,
  relationConflict,
  relationFromRole,
  relationRole,
  type Size,
  type StatusCategory,
  type TagIconName,
  type TaskRelationRole,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import type {
  commentActivity,
  comments,
  tags,
  taskActivity,
  taskRelations,
  tasks,
  taskTags,
} from './schema';

/**
 * The demo profile's sample content, kept free of the database so a unit test can check every
 * row against the shared schemas. `seed.ts` inserts what these builders return.
 */

const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// BlockNote documents, shaped as the description editor saves them (text blocks only).

type Inline = { type: 'text'; text: string; styles: Record<string, true> };
type Block = Record<string, unknown>;

const DEFAULT_PROPS = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' };

function inline(parts: (string | Inline)[]): Inline[] {
  return parts.map((part) => (typeof part === 'string' ? text(part) : part));
}
function text(value: string, styles: Record<string, true> = {}): Inline {
  return { type: 'text', text: value, styles };
}
const bold = (value: string) => text(value, { bold: true });
const code = (value: string) => text(value, { code: true });
const italic = (value: string) => text(value, { italic: true });

function block(
  type: string,
  parts: (string | Inline)[],
  props: Record<string, unknown> = {},
  children: Block[] = [],
): Block {
  return {
    id: uuidv7(),
    type,
    props: { ...DEFAULT_PROPS, ...props },
    content: inline(parts),
    children,
  };
}
const p = (...parts: (string | Inline)[]) => block('paragraph', parts);
const h = (level: 1 | 2 | 3, value: string) =>
  block('heading', [value], { level, isToggleable: false });
const li = (...parts: (string | Inline)[]) => block('bulletListItem', parts);
const ol = (...parts: (string | Inline)[]) => block('numberedListItem', parts);
const todo = (checked: boolean, ...parts: (string | Inline)[]) =>
  block('checkListItem', parts, { checked });
const quote = (...parts: (string | Inline)[]) => block('quote', parts);

export const DESCRIPTIONS = {
  offline: () => [
    p(
      'The board should stay ',
      bold('fully usable'),
      ' on a train or in a basement. Reads come from the device, and writes wait in the outbox until the server has them.',
    ),
    h(2, 'What should work'),
    li('Create, edit and move tasks with no connection'),
    li('Show a placeholder for the task number until it syncs'),
    li('Keep every queued change across a reload or an app restart'),
    h(2, 'How to try it'),
    ol('Open the board and switch on airplane mode'),
    ol('Create a task, then move it to ', code('In review')),
    ol('Reload, reconnect and check that its key appears'),
    quote('A change that the server refuses is listed on the task, never silently dropped.'),
  ],
  longTitle: () => [
    p(
      'Long titles wrap onto ',
      bold('three lines'),
      ' at most and fade out after that, so a column keeps its rhythm.',
    ),
    li('Check it beside an open task at ', code('1280px')),
    li('Check it in the phone layout with large text'),
  ],
  filters: () => [
    p('Filter the backlog by status without leaving the board.'),
    todo(true, 'Pick statuses from the toolbar'),
    todo(false, 'Remember the filter per project'),
    todo(false, 'Show how many tasks are hidden'),
  ],
  guide: () => [
    h(2, 'Outline'),
    ol('Requirements: Docker and a domain name'),
    ol('Copy ', code('compose.yaml'), ' and fill in ', code('.env')),
    ol('Start the stack and create the first account'),
    ol('Set up daily backups'),
    p(
      'Keep it short and link to ',
      italic('docs/deployment.md'),
      ' for the details rather than repeating them.',
    ),
  ],
  palette: () => [
    p('A quick way to jump to any task or project with ', code('Ctrl K'), '.'),
    li('Search tasks by key and title'),
    li('Run common actions, such as ', bold('New task'), ' or ', bold('Open settings')),
  ],
  van: () => [
    p('Book a van for ', bold('Saturday morning'), '. Ask for two movers if the price is right.'),
    h(3, 'Quotes'),
    li('Northside Removals: ', bold('£420'), ', includes blankets'),
    li('Van & Man: £310, no insurance'),
    p('Confirm parking at both addresses before booking.'),
  ],
} satisfies Record<string, () => NonNullable<Description>>;

export const COMMENTS = {
  offlinePlan: (): CommentBody => [
    p('Started with the outbox. Writes are stored before they are sent, so a reload keeps them.'),
  ],
  offlineQuestion: (): CommentBody => [
    p('Should a task created offline show ', code('THR-?'), ' or nothing at all until it syncs?'),
  ],
  offlineAnswer: (): CommentBody => [
    p('Nothing. A placeholder key looks like a real one in screenshots and bug reports.'),
    li('Keep the space so the card does not jump'),
    li('Fade the key in when it arrives'),
  ],
  longTitleWrap: (): CommentBody => [p('Three lines feels right on desktop. Phones may want two.')],
  longTitleCheck: (): CommentBody => [
    p('Checked with the drawer open on a 13" laptop: ', bold('no overflow'), '.'),
  ],
  guideDraft: (): CommentBody => [p('First draft is in the docs folder. Needs a backups section.')],
  guideReview: (): CommentBody => [
    p('Added backups. Could someone try it on a fresh server before the release?'),
  ],
  vanQuote: (): CommentBody => [p('Northside can do 8am. Holding the slot until Friday.')],
  vanParking: (): CommentBody => [
    p('Asked the council about a parking suspension. It takes ', bold('ten working days'), '.'),
  ],
} satisfies Record<string, () => CommentBody>;

// ---------------------------------------------------------------------------------------------
// Projects and tags.

/** Project icons share the tag icon set (`ProjectIcon` in the web app). */
export const DEMO_PROJECTS: { name: string; color: Color; icon: TagIconName }[] = [
  { name: 'Throw', color: 'amber', icon: 'rocket' },
  { name: 'House move', color: 'teal', icon: 'house' },
];

export type TagSpec = {
  name: string;
  color?: Color;
  icon?: TagIconName;
  children?: TagSpec[];
};

export const THROW_TAGS: TagSpec[] = [
  { name: 'Bug', color: 'red', icon: 'flag' },
  { name: 'Feature', color: 'blue', icon: 'sparkles' },
  { name: 'Polish', color: 'violet', icon: 'paintbrush' },
  { name: 'Docs', color: 'green', icon: 'book-open' },
  {
    // Uncolored, so tasks filed only under an area keep a neutral card.
    name: 'Area',
    icon: 'folder',
    children: [
      { name: 'Board' },
      { name: 'Mobile', children: [{ name: 'Android' }] },
      { name: 'Sync' },
      { name: 'Settings' },
    ],
  },
];

export const HOUSE_TAGS: TagSpec[] = [
  { name: 'Packing', color: 'orange', icon: 'archive' },
  { name: 'Logistics', color: 'cyan', icon: 'car' },
  { name: 'Admin', color: 'purple', icon: 'landmark' },
];

type Scope = { workspaceId: string; projectId: string };

export function buildTags(specs: TagSpec[], scope: Scope): (typeof tags.$inferInsert)[] {
  const rows: (typeof tags.$inferInsert)[] = [];
  function visit(siblings: TagSpec[], parentId: string | null) {
    const positions = positionsBetween(null, null, siblings.length);
    siblings.forEach((spec, index) => {
      const id = uuidv7();
      rows.push({
        ...scope,
        id,
        name: spec.name,
        parentId,
        color: spec.color ?? null,
        icon: spec.icon ?? null,
        position: positions[index]!,
      });
      visit(spec.children ?? [], id);
    });
  }
  visit(specs, null);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Tasks, their history and comments.

type State = {
  status: string;
  priority: Priority;
  size: Size | null;
  tag: string | null;
  tags: string[];
};

/** A later write to the task, as the server would record it. */
export type UpdateSpec = {
  daysAgo: number;
  status?: string;
  priority?: Priority;
  size?: Size | null;
  tag?: string | null;
  addTags?: string[];
  /** Saves the task's final description. */
  description?: true;
  trashed?: true;
};

export type TaskSpec = {
  /** A name for subtasks and comments to refer to. */
  ref?: string;
  title: string;
  status: string;
  priority?: Priority;
  size?: Size | null;
  parent?: string;
  /** The primary tag, by name. */
  tag?: string;
  /** Secondary tags, by name. */
  tags?: string[];
  description?: () => NonNullable<Description>;
  /** For a closed status: when it was closed. The task starts in the default active status. */
  closedDaysAgo?: number;
  trashedDaysAgo?: number;
  /** The state the task was created in, when its history changes it. */
  initial?: Partial<State>;
  history?: UpdateSpec[];
};

export type CommentSpec = { task: string; daysAgo: number; body: () => CommentBody };

export type StatusRow = { id: string; name: string; category: StatusCategory; isDefault: boolean };

export type ProjectFixtures = {
  tasks: (typeof tasks.$inferInsert)[];
  taskTags: (typeof taskTags.$inferInsert)[];
  activity: (typeof taskActivity.$inferInsert)[];
  comments: (typeof comments.$inferInsert)[];
  commentActivity: (typeof commentActivity.$inferInsert)[];
  /** Task ids by their spec's `ref`, for relations to name. */
  refs: Map<string, string>;
};

export function buildProjectFixtures(input: {
  scope: Scope;
  userId: string;
  now: Date;
  statuses: StatusRow[];
  tags: { id: string; name: string }[];
  tasks: TaskSpec[];
  comments: CommentSpec[];
  /** When the task at this index (in creation order) was created. */
  createdDaysAgo: (index: number) => number;
}): ProjectFixtures {
  const { scope, userId, now } = input;
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const statusByName = new Map(input.statuses.map((status) => [status.name, status]));
  const status = (name: string) => {
    const found = statusByName.get(name);
    if (!found) throw new Error(`Unknown status "${name}"`);
    return found;
  };
  const defaultActive = input.statuses.find((row) => row.category === 'active' && row.isDefault);
  const tagByName = new Map(input.tags.map((tag) => [tag.name, tag]));
  const tag = (name: string) => {
    const found = tagByName.get(name);
    if (!found) throw new Error(`Unknown tag "${name}"`);
    return found;
  };
  const tagName = (name: string | null) => (name === null ? null : tag(name).name);
  const tagId = (name: string | null) => (name === null ? null : tag(name).id);

  const positions = positionsBetween(null, null, input.tasks.length);
  const idByRef = new Map<string, string>();
  const out: ProjectFixtures = {
    tasks: [],
    taskTags: [],
    activity: [],
    comments: [],
    commentActivity: [],
    refs: idByRef,
  };

  input.tasks.forEach((spec, index) => {
    const id = uuidv7();
    if (spec.ref) idByRef.set(spec.ref, id);
    const parentId = spec.parent === undefined ? null : idByRef.get(spec.parent);
    if (parentId === undefined) throw new Error(`Parent "${spec.parent}" must come first`);
    const createdAt = at(input.createdDaysAgo(index));
    const final: State = {
      status: spec.status,
      priority: spec.priority ?? 3,
      size: spec.size ?? null,
      tag: spec.tag ?? null,
      tags: spec.tags ?? [],
    };
    const history = [...(spec.history ?? [])];
    const initial: Partial<State> = { ...spec.initial };
    if (spec.closedDaysAgo !== undefined && !history.some((update) => update.status)) {
      if (!defaultActive) throw new Error('No default active status');
      initial.status ??= defaultActive.name;
      history.push({ daysAgo: spec.closedDaysAgo, status: spec.status });
    }
    if (spec.trashedDaysAgo !== undefined)
      history.push({ daysAgo: spec.trashedDaysAgo, trashed: true });
    history.sort((a, b) => b.daysAgo - a.daysAgo);

    const state: State = { ...final, ...initial, tags: [...(initial.tags ?? final.tags)] };
    const finalDescription = spec.description?.() ?? null;
    const describedLater = history.some((update) => update.description);
    let descriptionVersion = finalDescription && !describedLater ? uuidv7() : null;
    let closedAt: Date | null = isClosedCategory(status(state.status).category) ? createdAt : null;
    let deletedAt: Date | null = null;

    const created: ActivityChange[] = [
      { field: 'title', previous: null, requested: spec.title, applied: true },
      {
        field: 'statusId',
        previous: null,
        requested: status(state.status).id,
        requestedName: state.status,
        applied: true,
      },
      { field: 'priority', previous: null, requested: state.priority, applied: true },
    ];
    if (state.size !== null)
      created.push({ field: 'size', previous: null, requested: state.size, applied: true });
    if (descriptionVersion !== null)
      created.push({
        field: 'description',
        previous: null,
        requested: descriptionVersion,
        applied: true,
      });
    if (parentId !== null)
      created.push({ field: 'parentId', previous: null, requested: parentId, applied: true });
    if (state.tag !== null)
      created.push({
        field: 'primaryTagId',
        previous: null,
        requested: tagId(state.tag),
        previousName: null,
        requestedName: tagName(state.tag),
        applied: true,
      });
    for (const name of state.tags) created.push(secondaryAdded(name));
    out.activity.push({
      ...scope,
      id,
      taskId: id,
      userId,
      kind: 'created',
      changes: created,
      createdAt,
    });

    function secondaryAdded(name: string): ActivityChange {
      return {
        field: 'secondaryTags',
        tagId: tag(name).id,
        previous: null,
        requested: tag(name).id,
        previousName: null,
        requestedName: tag(name).name,
        applied: true,
      };
    }

    for (const update of history) {
      const when = at(update.daysAgo);
      if (when <= createdAt) throw new Error(`"${spec.title}" changes before it was created`);
      const changes: ActivityChange[] = [];
      if (update.description) {
        const version = uuidv7();
        changes.push({
          field: 'description',
          previous: descriptionVersion,
          requested: version,
          applied: true,
        });
        descriptionVersion = version;
      }
      if (update.status !== undefined && update.status !== state.status) {
        const from = status(state.status);
        const to = status(update.status);
        changes.push({
          field: 'statusId',
          previous: from.id,
          requested: to.id,
          previousName: from.name,
          requestedName: to.name,
          applied: true,
        });
        if (!isClosedCategory(to.category)) closedAt = null;
        else if (!isClosedCategory(from.category)) closedAt = when;
        state.status = update.status;
      }
      if (update.priority !== undefined && update.priority !== state.priority) {
        changes.push({
          field: 'priority',
          previous: state.priority,
          requested: update.priority,
          applied: true,
        });
        state.priority = update.priority;
      }
      if (update.size !== undefined && update.size !== state.size) {
        changes.push({
          field: 'size',
          previous: state.size,
          requested: update.size,
          applied: true,
        });
        state.size = update.size;
      }
      if (update.tag !== undefined && update.tag !== state.tag) {
        changes.push({
          field: 'primaryTagId',
          previous: tagId(state.tag),
          requested: tagId(update.tag),
          previousName: tagName(state.tag),
          requestedName: tagName(update.tag),
          applied: true,
        });
        state.tag = update.tag;
      }
      if (update.trashed) {
        changes.push({ field: 'trashed', previous: false, requested: true, applied: true });
        deletedAt = when;
      }
      for (const name of update.addTags ?? []) {
        if (state.tags.includes(name)) continue;
        changes.push(secondaryAdded(name));
        state.tags.push(name);
      }
      if (!changes.length) throw new Error(`An update to "${spec.title}" changes nothing`);
      out.activity.push({
        ...scope,
        id: uuidv7(),
        taskId: id,
        userId,
        kind: 'updated',
        changes,
        createdAt: when,
      });
    }

    const mismatch = (Object.keys(final) as (keyof State)[]).find(
      (key) => JSON.stringify(state[key]) !== JSON.stringify(final[key]),
    );
    if (mismatch) throw new Error(`"${spec.title}" history ends with a different ${mismatch}`);

    out.tasks.push({
      ...scope,
      id,
      number: index + 1,
      title: spec.title,
      description: finalDescription,
      descriptionVersion,
      statusId: status(final.status).id,
      priority: final.priority,
      size: final.size,
      position: positions[index]!,
      parentId,
      primaryTagId: tagId(final.tag),
      closedAt,
      deletedAt,
      createdAt,
      updatedAt: history.length ? at(history.at(-1)!.daysAgo) : createdAt,
    });
    for (const name of final.tags) out.taskTags.push({ ...scope, taskId: id, tagId: tag(name).id });
  });

  const sortedComments = [...input.comments].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const spec of sortedComments) {
    const taskId = idByRef.get(spec.task);
    if (!taskId) throw new Error(`Unknown task "${spec.task}"`);
    const createdAt = at(spec.daysAgo);
    const id = uuidv7();
    const body = spec.body();
    out.comments.push({ ...scope, id, taskId, userId, body, createdAt, editedAt: null });
    out.commentActivity.push({
      ...scope,
      id: uuidv7(),
      taskId,
      commentId: id,
      kind: 'created',
      afterBody: body,
      userId,
      createdAt,
    });
  }

  // Every row shares the seed's transaction id; keep the change feed in time order.
  const events = [...out.activity, ...out.commentActivity].sort(
    (a, b) => a.createdAt!.getTime() - b.createdAt!.getTime(),
  );
  events.forEach((event, order) => {
    event.feedOrder = BigInt(order);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The two demo projects.

/** Statuses the Throw project adds to the starter set. */
export const THROW_EXTRA_STATUSES: [string, StatusCategory][] = [
  ['Ideas', 'backlog'],
  ['In review', 'active'],
  ['Testing', 'active'],
  ['Released', 'done'],
  ['Duplicate', 'cancelled'],
];

const OFFLINE = 'offline';
const LONG = 'long';
const GUIDE = 'guide';
const UNSENT = 'unsent';
const TRAY = 'tray';
const RELEASE = 'release';
const TRAY_REVIEW = 'tray-review';
const KEYS = 'keys';
const TRAY_COPY = 'tray-copy';
const TWO_FINGERS = 'two-fingers';

/** Refs for the tasks listed by title alone. */
const LISTED_REFS: Record<string, string> = {
  'Make the tray easy to reach': TRAY,
  'Write the self-hosting guide': GUIDE,
  'Prepare the next release': RELEASE,
};

// The publication splits the older shipped merges from the one still awaiting release.
export const THROW_GITHUB_EVENTS = [
  { ref: 'synced', daysAgo: 12, events: ['pr-merge'] },
  { ref: 'shell', daysAgo: 4, events: ['pr-merge'] },
  { daysAgo: 3, events: ['release'] },
  { ref: KEYS, daysAgo: 1, events: ['pr-merge'] },
  { ref: OFFLINE, daysAgo: 1, events: ['pr-draft', 'checks-pending'] },
  { ref: UNSENT, daysAgo: 1, events: ['issue-open'] },
  { ref: TRAY_COPY, daysAgo: 1, events: ['issue-close'] },
  { ref: TRAY_REVIEW, daysAgo: 1, events: ['pr-ready', 'checks-fail', 'review-changes'] },
  { ref: TRAY_REVIEW, pr: 201, daysAgo: 1, events: ['pr-ready', 'checks-pass', 'review-approve'] },
  { ref: LONG, daysAgo: 1, events: ['pr-ready', 'checks-pass', 'review-approve'] },
] as const;

export const THROW_TASKS: TaskSpec[] = [
  {
    ref: OFFLINE,
    title: 'Keep the board useful without a connection',
    status: 'In progress',
    priority: 1,
    size: 4,
    tag: 'Feature',
    tags: ['Sync'],
    description: DESCRIPTIONS.offline,
    initial: { status: 'Backlog', priority: 2, size: null, tag: null, tags: [] },
    history: [
      { daysAgo: 11, description: true },
      { daysAgo: 10, tag: 'Feature', addTags: ['Sync'] },
      { daysAgo: 9, size: 4, priority: 1 },
      { daysAgo: 6, status: 'In progress' },
    ],
  },
  {
    title: 'Create a task offline',
    status: 'Done',
    parent: OFFLINE,
    size: 2,
    tag: 'Feature',
    tags: ['Sync'],
    closedDaysAgo: 3,
  },
  {
    title: 'Show its number after reconnecting',
    status: 'In progress',
    parent: OFFLINE,
    size: 1,
    tag: 'Bug',
    tags: ['Sync'],
  },
  {
    ref: UNSENT,
    title: 'Keep unsent changes across a reload',
    status: 'Backlog',
    parent: OFFLINE,
    size: 3,
    tag: 'Feature',
  },
  {
    ref: LONG,
    title:
      'A quiet card with room for a long title, even when the board is squeezed beside an open task on a small laptop',
    status: 'In progress',
    priority: 2,
    size: 3,
    tag: 'Polish',
    tags: ['Board'],
    description: DESCRIPTIONS.longTitle,
    initial: { size: null, status: 'Backlog' },
    history: [
      { daysAgo: 8, description: true },
      { daysAgo: 7, status: 'In progress', size: 3 },
    ],
  },
  ...(
    [
      ['Subtask progress under the card', 'Feature', ['Board'], 2],
      ['Remember the last workspace', 'Feature', ['Settings'], 1],
      ['Status filters in the backlog', 'Feature', ['Board'], 3],
      ['Round the edges of scrolled cards', 'Polish', ['Board'], 1],
      ['A place for work still taking shape', null, [], null],
      ['Name each priority in settings', 'Settings', [], 2],
      ['Open a task beside the board', 'Feature', ['Board'], 4],
      ['Make the tray easy to reach', 'Mobile', ['Polish'], 3],
      ['Use the board in dark mode', 'Polish', [], 2],
      ['Keep focus when a task closes', 'Bug', ['Board'], 1],
      ['A column with enough work to scroll', null, [], null],
      ['Restore a project from the trash', 'Feature', [], 3],
      ['Try the board with reduced motion', 'Polish', [], null],
      ['Write the self-hosting guide', 'Docs', [], 4],
      ['Polish the empty state', 'Polish', [], 1],
      ['Prepare the next release', null, [], 5],
    ] as const
  ).map(
    ([title, tag, tags, size], index): TaskSpec => ({
      title,
      status: 'In progress',
      priority: ([2, 3, 4, 5] as const)[Math.floor(index / 4)]!,
      size,
      ...(tag ? { tag } : {}),
      tags: [...tags],
      ...(LISTED_REFS[title] ? { ref: LISTED_REFS[title] } : {}),
      ...(title === 'Status filters in the backlog' ? { description: DESCRIPTIONS.filters } : {}),
      ...(title === 'Write the self-hosting guide' ? { description: DESCRIPTIONS.guide } : {}),
    }),
  ),
  {
    ref: TRAY_REVIEW,
    title: 'Review the phone tray',
    status: 'In review',
    priority: 2,
    size: 2,
    tag: 'Android',
    tags: ['Polish'],
    initial: { status: 'In progress' },
    history: [{ daysAgo: 2, status: 'In review' }],
  },
  {
    title: 'Check the last card in a long column',
    status: 'Testing',
    size: 1,
    tag: 'Bug',
    tags: ['Board'],
  },
  {
    title: 'A command palette for later',
    status: 'Backlog',
    priority: 2,
    size: 5,
    tag: 'Feature',
    description: DESCRIPTIONS.palette,
  },
  { title: 'Bring notes across from Catch', status: 'Ideas', priority: 4 },
  { title: 'Explore milestones', status: 'Ideas', priority: 5, size: 5, tag: 'Feature' },
  {
    ref: KEYS,
    title: 'Make project keys readable',
    status: 'Done',
    size: 2,
    tag: 'Polish',
    closedDaysAgo: 1,
  },
  {
    ref: 'shell',
    title: 'Ship the responsive shell',
    status: 'Released',
    size: 5,
    tag: 'Feature',
    tags: ['Mobile', 'Board'],
    closedDaysAgo: 4,
  },
  {
    ref: 'synced',
    title: 'Start with synced tasks',
    status: 'Done',
    size: 4,
    tag: 'Feature',
    tags: ['Sync'],
    closedDaysAgo: 12,
  },
  {
    title: 'Import every issue automatically',
    status: 'Cancelled',
    priority: 4,
    size: 5,
    closedDaysAgo: 2,
  },
  {
    ref: TRAY_COPY,
    title: 'Second copy of the tray idea',
    status: 'Duplicate',
    tag: 'Mobile',
    closedDaysAgo: 8,
  },
  {
    ref: TWO_FINGERS,
    title: 'Drag cards with two fingers',
    status: 'Backlog',
    size: 3,
    tag: 'Feature',
    tags: ['Mobile'],
    trashedDaysAgo: 3,
  },
];

export const THROW_COMMENTS: CommentSpec[] = [
  { task: OFFLINE, daysAgo: 10.5, body: COMMENTS.offlinePlan },
  { task: OFFLINE, daysAgo: 8.2, body: COMMENTS.offlineQuestion },
  { task: OFFLINE, daysAgo: 7.9, body: COMMENTS.offlineAnswer },
  { task: LONG, daysAgo: 7.5, body: COMMENTS.longTitleWrap },
  { task: LONG, daysAgo: 1.3, body: COMMENTS.longTitleCheck },
  { task: GUIDE, daysAgo: 5, body: COMMENTS.guideDraft },
  { task: GUIDE, daysAgo: 0.4, body: COMMENTS.guideReview },
];

const VAN = 'van';
const KITCHEN = 'kitchen';
const COUNCIL = 'council';
const POST = 'post';

export const HOUSE_TASKS: TaskSpec[] = [
  {
    ref: VAN,
    title: 'Book the removal van',
    status: 'In progress',
    priority: 1,
    size: 3,
    tag: 'Logistics',
    description: DESCRIPTIONS.van,
    initial: { status: 'Backlog', priority: 2 },
    history: [{ daysAgo: 4, status: 'In progress', priority: 1 }],
  },
  {
    ref: KITCHEN,
    title: 'Pack the kitchen',
    status: 'In progress',
    priority: 2,
    size: 4,
    tag: 'Packing',
  },
  {
    title: 'Wrap the glasses',
    status: 'Done',
    parent: KITCHEN,
    size: 2,
    tag: 'Packing',
    closedDaysAgo: 2,
  },
  {
    title: 'Label the boxes by room',
    status: 'In progress',
    parent: KITCHEN,
    size: 1,
    tag: 'Packing',
  },
  { ref: POST, title: 'Redirect the post', status: 'Backlog', size: 1, tag: 'Admin' },
  {
    ref: COUNCIL,
    title: 'Tell the council about the move',
    status: 'Backlog',
    size: 2,
    tag: 'Admin',
    tags: ['Logistics'],
  },
  { title: 'Measure the new living room', status: 'Done', size: 1, closedDaysAgo: 5 },
  {
    title: 'Sell the old sofa',
    status: 'Cancelled',
    priority: 4,
    tag: 'Logistics',
    closedDaysAgo: 3,
  },
  { title: 'Hire a storage unit', status: 'Backlog', size: 3, tag: 'Logistics', trashedDaysAgo: 1 },
];

export const HOUSE_COMMENTS: CommentSpec[] = [
  { task: VAN, daysAgo: 3.6, body: COMMENTS.vanQuote },
  { task: VAN, daysAgo: 0.8, body: COMMENTS.vanParking },
];

/** Older tasks first, so numbers follow creation. */
export const THROW_CREATED_DAYS_AGO = (index: number) => 45 - index * 0.75;
export const HOUSE_CREATED_DAYS_AGO = (index: number) => 18 - index * 1.2;

// ---------------------------------------------------------------------------------------------
// Relations, made once both projects exist so they can cross between them.

export type TaskRef = { project: string; ref: string };
export type RelationSpec = {
  task: TaskRef;
  relation: TaskRelationRole;
  other: TaskRef;
  daysAgo: number;
};
export type SeededTask = { id: string; projectId: string; identifier: string; createdAt: Date };

const throwTask = (ref: string): TaskRef => ({ project: 'Throw', ref });
const houseTask = (ref: string): TaskRef => ({ project: 'House move', ref });

/**
 * The next release waits on open work in both projects (and on one finished task, which no
 * longer counts), the van waits on the council, and the tray ideas point at each other.
 */
export const DEMO_RELATIONS: RelationSpec[] = [
  { task: throwTask(TRAY_COPY), relation: 'duplicates', other: throwTask(TRAY), daysAgo: 8 },
  { task: throwTask(TWO_FINGERS), relation: 'relates_to', other: throwTask(TRAY), daysAgo: 5 },
  { task: throwTask(UNSENT), relation: 'blocks', other: throwTask(OFFLINE), daysAgo: 4.5 },
  { task: throwTask(RELEASE), relation: 'blocked_by', other: throwTask(KEYS), daysAgo: 4 },
  { task: throwTask(RELEASE), relation: 'blocked_by', other: throwTask(GUIDE), daysAgo: 3 },
  { task: throwTask(TRAY_REVIEW), relation: 'relates_to', other: throwTask(TRAY), daysAgo: 2.5 },
  { task: throwTask(RELEASE), relation: 'blocked_by', other: throwTask(TRAY_REVIEW), daysAgo: 2 },
  { task: throwTask(RELEASE), relation: 'blocked_by', other: houseTask(VAN), daysAgo: 1 },
  { task: houseTask(VAN), relation: 'blocked_by', other: houseTask(COUNCIL), daysAgo: 0.7 },
  { task: houseTask(POST), relation: 'relates_to', other: houseTask(COUNCIL), daysAgo: 0.6 },
];

/** Relation rows and the entry each end's history records, as `taskRelationWrites` does. */
export function buildRelationFixtures(input: {
  workspaceId: string;
  userId: string;
  now: Date;
  task: (ref: TaskRef) => SeededTask;
  relations: RelationSpec[];
}) {
  const { workspaceId, userId, now } = input;
  const rows: (typeof taskRelations.$inferInsert & { createdAt: Date })[] = [];
  const activity: (typeof taskActivity.$inferInsert)[] = [];
  for (const spec of [...input.relations].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const task = input.task(spec.task);
    const other = input.task(spec.other);
    const pair = relationFromRole(task.id, spec.relation, other.id);
    const conflict = relationConflict(rows, pair);
    if (conflict)
      throw new Error(`${task.identifier} ${spec.relation} ${other.identifier}: ${conflict}`);
    const createdAt = new Date(now.getTime() - spec.daysAgo * DAY);
    if (createdAt <= task.createdAt || createdAt <= other.createdAt)
      throw new Error(`${task.identifier} is linked to ${other.identifier} before both exist`);
    const row = { id: uuidv7(), workspaceId, ...pair, createdAt };
    rows.push(row);
    const [source, target] = row.sourceTaskId === task.id ? [task, other] : [other, task];
    for (const [end, far] of [
      [source, target],
      [target, source],
    ] as const) {
      activity.push({
        id: uuidv7(),
        workspaceId,
        projectId: end.projectId,
        taskId: end.id,
        userId,
        kind: 'updated',
        changes: [
          {
            field: 'relations',
            relationId: row.id,
            relation: relationRole(row, end.id)!.role,
            previous: null,
            requested: far.id,
            previousName: null,
            requestedName: far.identifier,
            applied: true,
          },
        ],
        createdAt,
        feedOrder: BigInt(activity.length),
      });
    }
  }
  return { relations: rows, activity };
}
