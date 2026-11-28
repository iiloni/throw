import { CircleDashed, Flag, Scaling, Tag, Trash2 } from 'lucide-react';
import { type ReactNode, useContext } from 'react';
import { type ControlProps, DockControl } from '@/components/DockControl/DockControl';
import { feelStatusChange } from '@/lib/haptics';
import {
  byCategory,
  CATEGORIES,
  categoryTarget,
  type Project,
  projectOf,
  type Status,
  statusById,
  type Task,
  targetCategory,
} from './model';
import { CATEGORY_NAMES } from './StatusMenu';
import { StatusTile } from './StatusTile';
import { type BoardState, board, current, leaveTask, sendTasks, update } from './state';
import { type SelectionContent, SelectionContentContext, type SelectionPanel } from './taskContent';

/** What a selection's controls open: the move grid, or one of the boundary's pickers. */
export type SelectionTab = 'status' | SelectionPanel;

export const selectionTabTitle: Record<SelectionTab, string> = {
  status: 'Status',
  priority: 'Priority',
  size: 'Size',
  tags: 'Tags',
};

/** The selected cards, including any a filter hides. */
export function selectedTasks(state: BoardState): Task[] {
  const data = current(state);
  return [...data.tasks, ...(data.hiddenTasks ?? [])].filter((task) =>
    state.selection.includes(task.id),
  );
}

/**
 * The statuses cards can be sent to: their project's. On the workspace board, cards from
 * several projects share no status, so they are sent to a category, and each lands in its
 * own project's default status there.
 */
export function moveTargets(project: Project, moving: Task[]): Status[] {
  if (!project.members) return project.statuses;
  const owners = new Set(moving.map((task) => task.projectId));
  if (owners.size === 1) return projectOf(project, moving[0]!).statuses;
  return CATEGORIES.map((category) => ({
    id: categoryTarget(category),
    name: CATEGORY_NAMES[category],
    category,
    isDefault: true,
  }));
}

/** The one project every selected card belongs to, or null when they span several. */
export function selectionProject(project: Project, selected: Task[]): Project | null {
  const first = selected[0];
  if (!first) return null;
  const own = projectOf(project, first);
  return selected.every((task) => projectOf(project, task).id === own.id) ? own : null;
}

/**
 * What a selection can change together. Tags belong to a project, so they are offered only for
 * cards of one project that has tags; without the boundary's pickers, only moving is.
 */
export function selectionTabs(
  project: Project,
  selected: Task[],
  content: Pick<SelectionContent, 'sizes'> | null,
): SelectionTab[] {
  if (!content) return ['status'];
  const own = selectionProject(project, selected);
  return [
    'status',
    'priority',
    ...(content.sizes ? (['size'] as const) : []),
    ...(own && own.tags.length > 0 ? (['tags'] as const) : []),
  ];
}

/** The value every selected card shares, or undefined when they differ. */
export function shared<T>(values: T[]): T | undefined {
  const [first, ...rest] = values;
  return rest.every((value) => value === first) ? first : undefined;
}

/** Sends the selection to a status, or a category on the workspace board, and lets it go. */
export function sendSelection(statusId: string) {
  const { project } = current();
  sendTasks(board.get().selection, statusId);
  update({ selection: [] });
  // As every status change is felt: finishing lands as success, anything else as a choice.
  const category = targetCategory(statusId) ?? statusById(project, statusId)?.category;
  if (category) feelStatusChange(category);
}

/** Trashes the selection and lets it go, leaving the open task if it went with it. */
export function trashSelection(content: SelectionContent) {
  const { selection, openTaskId } = board.get();
  if (selection.length === 0) return;
  content.trash(selection);
  update({ selection: [] });
  if (openTaskId && selection.includes(openTaskId)) leaveTask();
}

/** The move grid: the selection's statuses as tiles, colored as their columns are. */
export function StatusTargets({
  statuses,
  onPick,
}: {
  statuses: Status[];
  onPick?: (statusId: string) => void;
}) {
  return (
    <div className="space-y-2.5 pt-1">
      {byCategory(statuses).map((group) => (
        <section key={group.name} aria-label={group.name}>
          <h3 className="px-1 pb-1.5 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
            {group.name}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {group.statuses.map((status) => (
              <StatusTile
                key={status.id}
                status={status}
                shape="row"
                onPick={onPick ? () => onPick(status.id) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// One face however many cards are selected or what they share, so the controls do not shift
// as the selection grows or shrinks.
const icons: Record<SelectionTab, ReactNode> = {
  status: <CircleDashed />,
  priority: <Flag />,
  size: <Scaling />,
  tags: <Tag />,
};

/**
 * The selection's controls, as an open task's dock draws its own: status, priority, size and
 * tags open their pickers, and the trash acts at once.
 */
export function SelectionControls({
  tabs,
  onOpen,
  controlProps,
  tooltips,
}: {
  tabs: SelectionTab[];
  onOpen(tab: SelectionTab, element: HTMLButtonElement): void;
  controlProps(tab: SelectionTab): ControlProps;
  tooltips: boolean;
}) {
  const content = useContext(SelectionContentContext);
  return (
    <div className="grid h-full w-full auto-cols-fr grid-flow-col gap-1 p-1">
      {tabs.map((tab) => (
        <DockControl
          key={tab}
          label={selectionControlLabel[tab]}
          tooltip={tooltips}
          {...controlProps(tab)}
          onOpen={(element) => onOpen(tab, element)}
        >
          {icons[tab]}
        </DockControl>
      ))}
      {content && (
        <DockControl
          label="Move to trash"
          tooltip={tooltips}
          className="text-destructive/90 hover:text-destructive"
          onOpen={() => trashSelection(content)}
        >
          <Trash2 />
        </DockControl>
      )}
    </div>
  );
}

const selectionControlLabel: Record<SelectionTab, string> = {
  status: 'Change status',
  priority: 'Change priority',
  size: 'Change size',
  tags: 'Change tags',
};

/** One tab's content: the move grid here, the rest from the boundary. */
export function SelectionTabContent({
  tab,
  onDone,
  state: given,
}: {
  tab: SelectionTab;
  onDone: () => void;
  /** The board as a leaving panel last showed it, in place of the board as it is. */
  state?: BoardState;
}) {
  const live = board.use();
  const state = given ?? live;
  const content = useContext(SelectionContentContext);
  const { project } = current(state);
  if (tab === 'status')
    return (
      <StatusTargets
        statuses={moveTargets(project, selectedTasks(state))}
        onPick={(statusId) => sendSelection(statusId)}
      />
    );
  return content?.panel(tab, state.selection, onDone) ?? null;
}
