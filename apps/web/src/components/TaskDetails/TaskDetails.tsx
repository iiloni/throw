import {
  type ActivityEntry,
  comparePositions,
  type Project,
  type Status,
  type Tag,
  type Task,
  taskIdentifier,
  taskTagColor,
} from '@throw/shared';
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ShellContext } from '@/components/AppShell/shell';
import { StatusGlyph } from '@/components/Board/glyphs';
import { type Task as BoardTask, projectOf } from '@/components/Board/model';
import { StatusMenu } from '@/components/Board/StatusMenu';
import {
  board,
  canOpenTask,
  current,
  leaveTask,
  openNewSubtask,
  openSubtask,
  update,
} from '@/components/Board/state';
import { CARD_STATUS_CONTROL, TaskCard } from '@/components/Board/TaskCard';
import { cardSurface, TaskTitle } from '@/components/Board/TaskView';
import { TaskPaneWidthContext, TaskScrollContext } from '@/components/Board/taskMotionContext';
import type { EditorControls } from '@/components/DescriptionEditor/editorControls';
import { HistoryToolbar, useHasHistory } from '@/components/HistoryToolbar/HistoryToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import {
  ScrollToBottom,
  useScrollEdges,
  useScrollToBottom,
} from '@/components/ScrollToBottom/ScrollToBottom';
import { TaskGithubLinks } from '@/components/TaskGithubLinks/TaskGithubLinks';
import { TaskRelations, useRelationGroups } from '@/components/TaskRelations/TaskRelations';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import {
  useGithubReleases,
  useTags,
  useTaskGithubLinksOf,
  useTaskGithubReleasesOf,
  useTaskTags,
} from '@/lib/collections';
import { sortGithubLinks, useGithubRepository, useShownGithubLinks } from '@/lib/githubLinks';
import { taskReleases } from '@/lib/githubReleases';
import { haptics } from '@/lib/haptics';
import { createTask, restoreTask, sendTask, trashTask } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import { Fold, TaskColumnFrame, useTaskColumn } from './TaskColumn';
import { openTaskPanel } from './TaskControls';
import { TaskDescription } from './TaskDescription';
import { TaskDrawer } from './TaskDrawer';
import { TaskRefusalNotice, TaskTimeline } from './TaskTimeline';

function boardTask(task: Task, tags: readonly Tag[]): BoardTask {
  return {
    ...task,
    size: task.size ?? null,
    closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
    primaryTagColor: taskTagColor(task, tags),
    secondaryTagIds: [],
    description: undefined,
  };
}

export function TaskDetails({
  task,
  project,
  statuses,
  tasks,
  phone = false,
  drawerPage = false,
}: {
  task: Task;
  project: Project;
  statuses: Status[];
  tasks: Task[];
  /** On a phone the task's controls are the board drawer's dock (ADR 0009), resting over it. */
  phone?: boolean;
  /** On a phone, whether the board's drawer shows a page of the task's over its foot. */
  drawerPage?: boolean;
}) {
  const shareScroll = useContext(TaskScrollContext);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback(
    (element: HTMLDivElement | null) => {
      shareScroll?.(element);
      setScrollElement(element);
    },
    [shareScroll],
  );
  // Only a phone jumps to the end or blurs its edges: a desktop pane has a scrollbar, room to
  // see where it is, and its toolbars above the card rather than over it.
  const edges = useScrollEdges(phone ? scrollElement : null);
  const scrollToBottom = useScrollToBottom(phone ? scrollElement : null, edges);
  const [descriptionControls, setDescriptionControls] = useState<EditorControls | null>(null);
  const hasHistory = useHasHistory(descriptionControls);
  // On a phone both float just above the dock, over the content's end.
  const floating = phone && !drawerPage && (hasHistory || scrollToBottom !== null);
  const paneWidth = useContext(TaskPaneWidthContext);
  const { tags, isLoading: tagsLoading } = useTags(project.id);
  const { taskTags, isLoading: taskTagsLoading } = useTaskTags(task.id);
  const secondaryTagIds = useMemo(() => taskTags.map((row) => row.tagId), [taskTags]);
  const parent = tasks.find((row) => row.id === task.parentId);
  const state = board.use();
  // The task this one was opened from, if any: Back returns there rather than to the board.
  const stack = [...state.taskTrail, state.openTaskId];
  const below = tasks.find((row) => row.id === stack[stack.indexOf(task.id) - 1]);
  const children = tasks
    .filter((row) => row.parentId === task.id && row.deletedAt === null)
    .sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));
  // On the workspace board, the task's own project: its subtasks move among its statuses.
  const boardProject = projectOf(current().project, task);
  const [recovery, setRecovery] = useState<ActivityEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The board's copies carry each subtask's secondary tags, including under a trashed parent.
  const data = current(state);
  const boardTasks = useMemo(
    () => new Map([...data.tasks, ...(data.hiddenTasks ?? [])].map((row) => [row.id, row])),
    [data],
  );
  // Beside the board, a subtask left for its parent's pane hands focus to its card there, as
  // the phone screen returns it to its opener, so the keyboard carries on where it was.
  useEffect(() => {
    if (phone || task.parentId === null) return;
    const id = task.id;
    return () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        // The copy that can be reached: the column's, or the inline list's.
        [
          ...document.querySelectorAll<HTMLElement>(
            `[aria-label="Task"] [data-card-id="${CSS.escape(id)}"]`,
          ),
        ]
          .find((card) => !card.closest('[inert]'))
          ?.focus();
      });
    };
  }, [phone, task.id, task.parentId]);
  function addSubtask() {
    try {
      const id = createTask(project.id, { parentId: task.id });
      setError(null);
      haptics.success();
      openNewSubtask(id, task.id);
    } catch {
      setError('The subtask could not be added. Try again.');
    }
  }
  // Finished work only, as the card's progress counts it: a cancelled subtask was not done.
  const done = children.filter(
    (child) => statuses.find((row) => row.id === child.statusId)?.category === 'done',
  ).length;
  const hasTags = [task.primaryTagId, ...secondaryTagIds].some(
    (id) => id !== null && tags.some((tag) => tag.id === id),
  );
  const shell = useContext(ShellContext);
  const { groups: relationGroups, isLoading: relationsLoading } = useRelationGroups(task);
  const { links: githubRows, isLoading: githubLoading } = useTaskGithubLinksOf(task.id);
  const shownGithub = useShownGithubLinks(githubRows);
  const githubLinks = useMemo(() => sortGithubLinks(shownGithub), [shownGithub]);
  const { releases: allReleases, isLoading: releasesLoading } = useGithubReleases();
  const { bindings, isLoading: bindingsLoading } = useTaskGithubReleasesOf(task.id);
  const released = useMemo(
    () => taskReleases(task.id, allReleases, bindings, githubLinks),
    [task.id, allReleases, bindings, githubLinks],
  );
  const column = useTaskColumn({
    paneWidth: phone ? null : paneWidth,
    hasExtras:
      hasTags ||
      (task.parentId === null && children.length > 0) ||
      relationGroups.length > 0 ||
      githubLinks.length > 0 ||
      released.releases.length > 0,
    ready:
      !tagsLoading &&
      !taskTagsLoading &&
      !relationsLoading &&
      !githubLoading &&
      !releasesLoading &&
      !bindingsLoading,
  });
  const tagRow = (
    <TaskTags tags={tags} primaryTagId={task.primaryTagId} secondaryTagIds={secondaryTagIds} />
  );
  /**
   * A related task on this board opens over this one, so Back returns here as it does from a
   * subtask. One in another project opens on its own board.
   */
  function openRelated(other: Task, origin?: HTMLElement | null) {
    if (canOpenTask(other.id)) openSubtask(other.id, origin);
    else shell?.openTask(other.projectId, other.id);
  }
  const linkCount =
    relationGroups.reduce((sum, group) => sum + group.items.length, 0) +
    githubLinks.length +
    released.releases.length;
  const hasOpenBlocker = relationGroups.some(
    (group) =>
      group.role === 'blocked_by' && group.items.some((item) => !item.closed && !item.trashed),
  );
  /** The task's links: related tasks, then its releases, pull requests and issues. */
  const relations = () => (
    <div className="flex flex-col gap-3">
      <TaskRelations task={task} groups={relationGroups} onOpen={openRelated} />
      <TaskGithubLinks
        links={githubLinks}
        releases={released.releases}
        unreleased={released.unreleased}
      />
    </div>
  );
  // The picker also takes a pasted pull request or issue once the project follows a repository.
  const githubRepository = useGithubRepository(project.id);
  const addLinkButton = (
    <button
      type="button"
      onClick={(event) => openTaskPanel(task.id, 'relations', event.currentTarget)}
      className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-foreground/15 border-dashed px-4 text-muted-foreground text-sm outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
    >
      <Plus className="size-4" aria-hidden />
      {githubRepository ? 'Link a task, PR or issue' : 'Link a task'}
    </button>
  );
  /** The subtasks with their slot to add one, inline below the description or in the column. */
  const subtasks = (
    placement: 'inline' | 'column',
    wrapList: (list: ReactNode) => ReactNode = (l) => l,
  ) => (
    <section
      aria-label="Subtasks"
      className={cn('flex flex-col gap-2', placement === 'inline' && 'mt-8')}
    >
      <h2 className="px-1 font-medium text-muted-foreground text-xs tabular-nums">
        {children.length ? `Subtasks · ${done}/${children.length}` : 'Subtasks'}
      </h2>
      {wrapList(
        <div className="flex flex-col gap-2">
          {children.map((child) => {
            const childStatus = statuses.find((row) => row.id === child.statusId);
            return (
              <TaskCard
                key={child.id}
                className={
                  placement === 'inline'
                    ? // Over its own tint, so a subtask keeps its colour, lifted off its parent's.
                      'border-foreground/20 bg-[image:linear-gradient(var(--raise),var(--raise))] shadow-sm'
                    : undefined
                }
                task={{
                  ...boardTask(child, tags),
                  secondaryTagIds: boardTasks.get(child.id)?.secondaryTagIds ?? [],
                }}
                showStatus
                onOpen={(origin) => openSubtask(child.id, origin)}
                statusControl={
                  childStatus && (
                    <StatusMenu
                      project={boardProject}
                      value={child.statusId}
                      onSelect={(id) => sendTask(child.id, id)}
                    >
                      <button
                        type="button"
                        data-no-drag=""
                        aria-label={`Status of ${child.title || 'Untitled subtask'}: ${childStatus.name}. Change`}
                        className={cn(
                          CARD_STATUS_CONTROL,
                          'outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60',
                        )}
                      >
                        <StatusGlyph
                          category={childStatus.category}
                          color={childStatus.color}
                          className="size-3"
                        />
                        <span className="truncate">{childStatus.name}</span>
                      </button>
                    </StatusMenu>
                  )
                }
              />
            );
          })}
        </div>,
      )}
      {/* A slot in the list's own shape: the subtask is made at once and grows out of its
          card as a task of its own, to be written in the full view. */}
      <button
        type="button"
        onClick={addSubtask}
        className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-foreground/15 border-dashed px-4 text-muted-foreground text-sm outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        <Plus className="size-4" />
        Add subtask
      </button>
      {error && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
  const card = (
    <ScrollArea
      data-task-card=""
      className={cn('min-h-0 min-w-0 flex-1 [--scrollbar-inset:1rem]', !phone && cardSurface)}
    >
      <ScrollAreaViewport
        ref={attachScroll}
        // The toolbars float over the content's start, and the dock rests over its end with
        // undo and the jump to the end floating above it; focus and the caret stay clear of
        // them.
        className={cn(
          phone &&
            cn(
              'scroll-pt-[calc(var(--safe-top)+4.5rem)]',
              floating
                ? 'scroll-pb-[calc(var(--dock-height)+var(--safe-bottom)+6.25rem)]'
                : 'scroll-pb-[calc(var(--dock-height)+var(--safe-bottom)+2.5rem)]',
            ),
        )}
      >
        <div
          className={cn(
            'px-6 sm:px-8',
            phone
              ? cn(
                  // At rest the title starts below the toolbars, where it sat beneath them.
                  'pt-[calc(var(--safe-top)+5.75rem)]',
                  hasHistory
                    ? 'pb-[calc(var(--dock-height)+var(--safe-bottom)+6.75rem)]'
                    : 'pb-[calc(var(--dock-height)+var(--safe-bottom)+3rem)]',
                )
              : 'pt-7 pb-10',
          )}
        >
          <TaskTitle task={boardTask(task, tags)} />
          {task.deletedAt && (
            <p role="status" className="mt-4 text-muted-foreground text-sm">
              This task is in the trash. Restore it from the toolbar.
            </p>
          )}
          {parent?.deletedAt && (
            <p className="mt-4 text-muted-foreground text-sm">
              This subtask is in the trash with its parent. Restore the parent to bring it back.
            </p>
          )}
          <Fold data-fold="tags" amount={column.inline} hidden={column.fits}>
            <div data-task-tags="" className="mt-3 empty:hidden">
              {tagRow}
            </div>
          </Fold>
          <TaskRefusalNotice key={`notice:${task.id}`} taskId={task.id} />
          <TaskDescription task={task} recovery={recovery} onControls={setDescriptionControls} />
          {task.parentId === null && (
            <Fold data-fold="subtasks" amount={column.closed} hidden={column.open}>
              {/* Flush with the task, as Catch lists a note's links below it. */}
              {subtasks('inline', (list) => (
                <Fold amount={column.inline} hidden={column.fits}>
                  {column.inlineMounted && list}
                </Fold>
              ))}
            </Fold>
          )}
          <TaskTimeline
            key={`timeline:${task.id}`}
            task={task}
            project={project}
            context={{
              priorityNames: project.priorityNames,
              parentName: (id) => {
                const parent = tasks.find((row) => row.id === id);
                return parent ? (taskIdentifier(project, parent) ?? undefined) : undefined;
              },
            }}
            onRecoverDescription={(entry) => setRecovery({ ...entry })}
            links={{
              inTabs: !column.fits,
              mounted: column.inlineMounted,
              count: linkCount,
              blocked: hasOpenBlocker,
              content: relations(),
              add: addLinkButton,
            }}
          />
        </div>
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollArea>
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col pb-[var(--keyboard)]">
      {phone && (
        // Catch's full-screen note: the task scrolls the whole height of the screen, under its
        // toolbars and its dock, and blurs away beneath them while there is more that way.
        <>
          <div
            aria-hidden
            data-task-top-blur=""
            className="page-top-blur pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--safe-top)+8rem)] transition-opacity duration-200"
            style={{ opacity: edges.top ? 1 : 0 }}
          />
          <div
            aria-hidden
            data-task-bottom-blur=""
            className="page-bottom-blur pointer-events-none absolute inset-x-0 bottom-[var(--keyboard)] z-10 h-[calc(var(--dock-height)+var(--safe-bottom)+3rem)] transition-opacity duration-200"
            style={{ opacity: edges.bottom ? 1 : 0 }}
          />
        </>
      )}
      {/* Beside the board, the toolbars sit above the task's card and line up with its edges,
          and its controls are a dock below it, as Catch's split view holds a note. On a phone
          they float over the task, and touches between them reach it. */}
      <header
        data-task-header=""
        className={cn(
          'flex shrink-0 items-start justify-between gap-3',
          phone
            ? 'pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[calc(var(--safe-top)+0.75rem)] pb-3'
            : 'pb-3',
        )}
      >
        <div className="flex min-w-0 items-start gap-1">
          <div
            role="toolbar"
            aria-label="Task navigation"
            className="glass pointer-events-auto flex min-w-0 items-center rounded-full p-1"
          >
            <IconButton
              label={
                below
                  ? `Back to ${taskIdentifier(project, below) ?? 'the parent task'}`
                  : 'Back to the board'
              }
              onClick={leaveTask}
              className="size-10 shrink-0 [&_svg]:size-5"
            >
              <ChevronLeft />
            </IconButton>
            <nav
              aria-label="Task breadcrumb"
              className="flex min-w-0 items-center gap-1 pr-4 text-muted-foreground text-sm tabular-nums"
            >
              {parent && (
                <>
                  <button
                    type="button"
                    aria-label={`Open parent ${taskIdentifier(project, parent) ?? 'Pending'}`}
                    onClick={() =>
                      below?.id === parent.id ? leaveTask() : update({ openTaskId: parent.id })
                    }
                    className="min-h-10 truncate rounded-full px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  >
                    {taskIdentifier(project, parent) ?? 'Pending'}
                  </button>
                  <ChevronRight aria-hidden className="size-3 shrink-0" />
                </>
              )}
              <span className="truncate" aria-current="page">
                {taskIdentifier(project, task) ?? 'Pending'}
              </span>
            </nav>
          </div>
          {/* Beside Back, as Catch's split view holds a note's history. A phone has no width to
            spare here; there it floats above the dock. */}
          {!phone && <HistoryToolbar controls={descriptionControls} />}
        </div>
        <div
          role="toolbar"
          aria-label="Task trash"
          className="glass pointer-events-auto flex shrink-0 rounded-full p-1"
        >
          <IconButton
            label={task.deletedAt ? 'Restore task' : 'Move to trash'}
            className="size-10 text-destructive hover:text-destructive [&_svg]:size-5"
            onClick={() => {
              // Felt once it is done: either can throw if the task went meanwhile.
              if (task.deletedAt) {
                restoreTask(task.id);
                haptics.success();
              } else {
                const id = task.id;
                const label = taskIdentifier(project, task);
                trashTask(id);
                haptics.warning();
                leaveTask();
                toast(label ? `${label} moved to the trash` : 'Task moved to the trash', {
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      try {
                        restoreTask(id);
                        haptics.success();
                      } catch {
                        // The task may have been purged meanwhile.
                      }
                    },
                  },
                });
              }
            }}
          >
            {task.deletedAt ? <RotateCcw /> : <Trash2 />}
          </IconButton>
        </div>
      </header>
      {phone ? (
        card
      ) : (
        <TaskColumnFrame layout={column} card={card}>
          {tagRow}
          {task.parentId === null && subtasks('column')}
          <div className="flex flex-col gap-2">
            {linkCount > 0 ? (
              relations()
            ) : (
              <h2 className="px-1 font-medium text-muted-foreground text-xs">Links</h2>
            )}
            {addLinkButton}
          </div>
        </TaskColumnFrame>
      )}
      {!phone && <TaskDrawer task={task} statuses={statuses} />}
      {phone && (
        // The dock's width and place: its glass tops out 1.75rem above the safe area (or the
        // keyboard it rides), and these float 0.75rem above that, at its ends.
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--keyboard)+var(--safe-bottom)+var(--dock-height)+2.5rem)] z-20 mx-auto max-w-md">
          <HistoryToolbar
            controls={descriptionControls}
            floating
            hidden={drawerPage}
            className="pointer-events-auto absolute bottom-0 left-3"
          />
          <ScrollToBottom
            onJump={scrollToBottom}
            hidden={drawerPage}
            className="pointer-events-auto absolute right-3 bottom-0"
          />
        </div>
      )}
    </div>
  );
}
