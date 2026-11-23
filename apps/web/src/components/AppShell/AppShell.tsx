import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { comparePositions } from '@throw/shared';
import {
  Columns3,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ProjectSwitcher } from '@/components/AppShell/ProjectSwitcher';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { useSwitcherPull } from '@/components/AppShell/SwitcherPull';
import {
  navigationSchema,
  type ProjectView,
  ShellContext,
  type ShellState,
  viewSchema,
} from '@/components/AppShell/shell';
import { AppUpdatePrompt } from '@/components/AppUpdatePrompt/AppUpdatePrompt';
import {
  board,
  closeSearch,
  focusSearch,
  narrowed,
  openSearch,
  update,
} from '@/components/Board/state';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { CommandPalette, type PaletteMode } from '@/components/CommandPalette/CommandPalette';
import { Hint } from '@/components/Hint/Hint';
import { ManagementSurfaceProvider } from '@/components/ManagementSurface/ManagementSurface';
import { NewTagHost } from '@/components/NewTag/NewTagHost';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { SettingsHub } from '@/components/SettingsLayout/SettingsHub';
import { type ShellForm, ShellForms } from '@/components/ShellForms/ShellForms';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { WebUpdatePrompt } from '@/components/WebUpdatePrompt/WebUpdatePrompt';
import { getSignedInUser } from '@/lib/auth';
import { useProjects, useWorkspaces } from '@/lib/collections';
import { useDesktop, useMedia } from '@/lib/media';
import { springs } from '@/lib/motion';
import { projectsIn } from '@/lib/projects';
import { usePersistentState } from '@/lib/storage';
import { useAwaitingSync } from '@/lib/syncStatus';
import { watchUpdates } from '@/lib/updates';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { cn } from '@/lib/utils';

const railSchema = z.boolean().nullable();
const paramsSchema = z.object({
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
});

export function AppShell() {
  const navigate = useNavigate();
  useEffect(watchUpdates, []);
  const rawParams = useRouterState({ select: (state) => state.matches.at(-1)?.params });
  // From the rendered match, as the params are: the location moves first while a navigation
  // loads, and reading it would swap the shell's layout before its page.
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  const params = paramsSchema.parse(rawParams ?? {});
  const location = useRouterState({ select: (state) => state.location });
  const navigating = useRouterState({ select: (state) => state.isLoading });
  const { workspaces: allWorkspaces, isLoading: loadingWorkspaces } = useWorkspaces();
  const { projects: allProjects, isLoading: loadingProjects } = useProjects();
  const userId = getSignedInUser()?.id ?? 'unknown';
  const [remembered, remember] = usePersistentState(
    `throw-navigation-${userId}`,
    navigationSchema,
    { workspaceId: null, projects: {} },
  );
  const [railChoice, setRailChoice] = usePersistentState('throw-rail-expanded', railSchema, null);
  const wide = useMedia('(min-width: 1200px)');
  const desktop = useDesktop();
  const expanded = railChoice ?? wide;
  const reduced = useReducedMotion();
  const [palette, setPalette] = useState<{ mode: PaletteMode; seed: string } | null>(null);
  const [pendingTask, setPendingTask] = useState<{
    projectId: string;
    taskId: string;
    created?: boolean;
  } | null>(null);
  const [form, setForm] = useState<ShellForm | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);
  const openSwitcher = useCallback(() => setSwitcherOpen(true), []);
  const mainRef = useRef<HTMLElement>(null);
  const formOpen = form !== null;
  useEffect(() => (formOpen ? holdUpdateReload() : undefined), [formOpen]);
  const workspaces = [...allWorkspaces].sort((a, b) => comparePositions(a.position, b.position));
  const preferredWorkspace = workspaces.find((item) => item.id === remembered.workspaceId);
  const workspace = params.workspaceId
    ? workspaces.find((item) => item.id === params.workspaceId)
    : (preferredWorkspace ?? (remembered.workspaceId ? undefined : workspaces[0]));
  const projects = workspace ? projectsIn(allProjects, workspace.id) : [];
  const project = projects.find((item) => item.id === params.projectId);
  const preferredProjectId = params.projectId ?? remembered.projects[workspace?.id ?? ''];
  const awaitingWorkspaces = useAwaitingSync(loadingWorkspaces, workspace ? 1 : 0);
  const awaitingProjects = useAwaitingSync(
    loadingProjects,
    preferredProjectId
      ? Number(projects.some((item) => item.id === preferredProjectId))
      : allProjects.length,
  );
  const view = viewSchema.catch('board').parse((location.search as { view?: unknown }).view);
  const crossBoard = routeId === '/_app/w/$workspaceId/board';
  const projectBoard = !!project && routeId === '/_app/w/$workspaceId/p/$projectId';
  // Both boards fill the window under their own header and dock.
  const fullBoard = projectBoard || (crossBoard && !!workspace && projects.length > 0);
  const openPalette = useCallback(
    (mode: PaletteMode = 'search', seed = '') => setPalette({ mode, seed }),
    [],
  );
  // A pull from the top of a phone board opens the switcher, as the title does.
  useSwitcherPull(
    mainRef,
    !desktop && fullBoard && !navigating && !switcherOpen && !form && !palette,
    openSwitcher,
  );
  // A desktop switches from the rail; a phone that grows into one puts its switcher away.
  useEffect(() => {
    if (desktop) setSwitcherOpen(false);
  }, [desktop]);
  // On a desktop board, search is the bar over the live board; elsewhere it is the palette,
  // as it is while a board is on its way out and its page's code still loading.
  const boardSearch = desktop && fullBoard && !navigating;
  const search = useCallback(() => {
    if (boardSearch) openSearch();
    else setPalette({ mode: 'search', seed: '' });
  }, [boardSearch]);
  const boardState = board.use();
  const isAppSettings = routeId?.startsWith('/_app/settings') ?? false;
  const isProjectSettings =
    routeId === '/_app/w/$workspaceId/p/$projectId_/settings' ||
    routeId === '/_app/w/$workspaceId/p/$projectId_/trash';
  const settings = isAppSettings || isProjectSettings;
  const inSettingsHub = isAppSettings || (isProjectSettings && !!project);
  const hubProject =
    project ??
    projects.find((item) => item.id === remembered.projects[workspace?.id ?? '']) ??
    projects[0];

  useEffect(() => {
    if (navigating || !workspace || !params.workspaceId) return;
    if (
      remembered.workspaceId === workspace.id &&
      (!project || remembered.projects[workspace.id] === project.id)
    )
      return;
    remember({
      workspaceId: workspace.id,
      projects: project
        ? { ...remembered.projects, [workspace.id]: project.id }
        : remembered.projects,
    });
  }, [navigating, workspace, project, params.workspaceId, remembered, remember]);

  function selectProject(
    workspaceId: string,
    projectId: string,
    nextView: ProjectView = 'board',
    replace = false,
    viewTransition?: false,
  ) {
    remember({ workspaceId, projects: { ...remembered.projects, [workspaceId]: projectId } });
    void navigate({
      to: '/w/$workspaceId/p/$projectId',
      params: { workspaceId, projectId },
      search: { view: nextView },
      replace,
      viewTransition,
    });
  }
  function selectWorkspace(id: string, leaving?: string) {
    // Straight to the board the workspace would open, so the switch is one cross-fade rather
    // than a fade to its loading page and another to the board.
    const inWorkspace = projectsIn(allProjects, id).filter((item) => item.id !== leaving);
    const next = inWorkspace.find((item) => item.id === remembered.projects[id]) ?? inWorkspace[0];
    if (next) return selectProject(id, next.id);
    remember({ ...remembered, workspaceId: id });
    void navigate({ to: '/w/$workspaceId', params: { workspaceId: id } });
  }
  function goBoard() {
    if (workspace)
      void navigate({
        to: '/w/$workspaceId/board',
        params: { workspaceId: workspace.id },
        search: { view: 'board' },
      });
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      if (!workspace || form) return;
      if (palette) return setPalette(null);
      if (document.querySelector('[role="dialog"]')) return;
      if (!boardSearch) return setPalette({ mode: 'search', seed: '' });
      // The bar: open it, or take the caret back to it; from inside it, close an empty one.
      const state = board.get();
      const input = document.querySelector('[data-board-search-input]');
      if (!state.searching) openSearch();
      else if (document.activeElement === input && !narrowed(state)) {
        closeSearch();
        document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
      } else focusSearch();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [workspace, form, palette, boardSearch]);
  useEffect(() => {
    const here = crossBoard ? `workspace:${workspace?.id}` : pendingTask?.projectId;
    if (!pendingTask || boardState.projectId !== here || !boardState.actions) return;
    if (
      !boardState.boards.some(
        (data) =>
          data.tasks.some((task) => task.id === pendingTask.taskId) ||
          data.hiddenTasks?.some((task) => task.id === pendingTask.taskId),
      )
    )
      return;
    update({
      openTaskId: pendingTask.taskId,
      ...(pendingTask.created ? { backlogFilter: null } : {}),
    });
    setPendingTask(null);
  }, [pendingTask, boardState, crossBoard, workspace?.id]);
  // Old shell links still open the palette without replacing the board with a search page.
  useEffect(() => {
    if (view !== 'search' || !workspace) return;
    search();
    if (project)
      void navigate({
        to: '/w/$workspaceId/p/$projectId',
        params: { workspaceId: workspace.id, projectId: project.id },
        search: { view: 'board' },
        replace: true,
      });
    else
      void navigate({
        to: '/w/$workspaceId/board',
        params: { workspaceId: workspace.id },
        search: { view: 'board' },
        replace: true,
      });
  }, [view, workspace, project, navigate, search]);
  const context: ShellState = {
    workspaces,
    workspace,
    projects,
    project,
    awaitingWorkspaces,
    awaitingProjects,
    remembered,
    view,
    crossBoard,
    board: fullBoard,
    settings,
    selectProject,
    selectWorkspace,
    openForm: setForm,
    switcher: desktop ? null : { open: switcherOpen, show: openSwitcher },
    goBoard,
    openPalette,
    search,
    openTask: (projectId, taskId, created) => {
      if (!workspace) return;
      setPendingTask({ projectId, taskId, created });
      // The cross-project board opens any of its projects' tasks in place. While a navigation
      // loads, the board still on screen is leaving, so the task goes to its own board.
      const inPlace = !navigating && (crossBoard || (project?.id === projectId && projectBoard));
      // The task's own opening is the motion here; a cross-fade would run under it.
      if (!inPlace) selectProject(workspace.id, projectId, 'board', false, false);
    },
    goProjectSettings: (project) => {
      void navigate({
        to: '/w/$workspaceId/p/$projectId/settings',
        params: { workspaceId: project.workspaceId, projectId: project.id },
      });
    },
    goTrash: (project) => {
      if (project)
        void navigate({
          to: '/w/$workspaceId/p/$projectId/trash',
          params: { workspaceId: project.workspaceId, projectId: project.id },
        });
      else if (workspace)
        void navigate({ to: '/w/$workspaceId/trash', params: { workspaceId: workspace.id } });
    },
    goSettings: () => {
      void navigate({ to: '/settings' });
    },
  };

  return (
    <ShellContext.Provider value={context}>
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-[80] rounded-xl bg-popover p-3 focus:not-sr-only"
      >
        Skip to content
      </a>
      <ManagementSurfaceProvider active={!fullBoard}>
        <div className="flex min-h-dvh">
          {desktop && (
            <motion.aside
              aria-label="Navigation rail"
              data-rail=""
              data-expanded={expanded}
              initial={false}
              animate={{ width: expanded ? 248 : 80 }}
              transition={reduced ? { duration: 0 } : { ...springs.smooth, bounce: 0 }}
              className="glass sticky top-0 flex h-dvh shrink-0 flex-col overflow-hidden border-y-0 border-l-0 pt-[calc(var(--safe-top)+0.75rem)] pb-[calc(var(--safe-bottom)+0.75rem)] pl-[var(--safe-left)]"
            >
              {/*
              Inset so the mark sits on the rail's icon column. The lockup measures this box
              and falls back to the mark alone once the collapsed rail is too narrow for it.
            */}
              <div className="mb-2 pr-3 pl-[1.125rem]">
                <BrandLockup orientation="horizontal" iconSize={32} />
              </div>
              <div className="px-3">
                <ShellMenu expanded={expanded} />
              </div>
              {workspace && (
                <div className="mt-3 px-3">
                  <RailButton label="Search" expanded={expanded} onClick={search}>
                    <Search className="size-5" aria-hidden />
                  </RailButton>
                </div>
              )}
              <nav
                aria-label="Projects"
                className="mt-5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3"
              >
                {projects.map((item) => (
                  <div key={item.id} className="group/project relative shrink-0">
                    <RailButton
                      label={item.name}
                      href={`/w/${item.workspaceId}/p/${item.id}?view=board`}
                      expanded={expanded}
                      active={projectBoard && project?.id === item.id}
                      tint={item.color}
                      className={expanded ? 'pr-11' : undefined}
                      onClick={() => selectProject(item.workspaceId, item.id)}
                    >
                      <ProjectIcon name={item.icon} className="size-5 text-tint-accent" />
                    </RailButton>
                    {expanded && (
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button
                            type="button"
                            aria-label={`Project menu for ${item.name}`}
                            className="absolute top-2 right-1 flex size-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MoreHorizontal aria-hidden className="size-4" />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="start"
                            side="right"
                            sideOffset={8}
                            collisionPadding={12}
                            className="glass-thick z-40 min-w-48 rounded-2xl p-2"
                          >
                            <DropdownMenu.Item
                              className="flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-sm outline-none focus:bg-accent"
                              onSelect={() => context.goProjectSettings(item)}
                            >
                              Project settings
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-sm outline-none focus:bg-accent"
                              onSelect={() => context.goTrash(item)}
                            >
                              Project trash
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    )}
                  </div>
                ))}
                {workspace && (
                  <RailButton
                    label="New project"
                    expanded={expanded}
                    onClick={() => setForm({ kind: 'new-project', workspace })}
                  >
                    <Plus aria-hidden className="size-5" />
                  </RailButton>
                )}
                {workspace && (
                  <div className="mt-3 border-t pt-3">
                    <RailButton
                      label="All projects"
                      href={`/w/${workspace.id}/board`}
                      expanded={expanded}
                      active={crossBoard}
                      onClick={goBoard}
                    >
                      <Columns3 aria-hidden className="size-5" />
                    </RailButton>
                  </div>
                )}
              </nav>
              <div className="mt-3 flex flex-col gap-2 px-3">
                {fullBoard && (
                  <div className="px-2">
                    <SyncIndicator />
                  </div>
                )}

                <RailButton
                  label="Settings"
                  href="/settings"
                  expanded={expanded}
                  active={settings}
                  onClick={context.goSettings}
                >
                  <Settings aria-hidden className="size-5" />
                </RailButton>
                <RailButton
                  label={expanded ? 'Collapse navigation' : 'Expand navigation'}
                  expanded={expanded}
                  onClick={() => setRailChoice(!expanded)}
                >
                  {expanded ? (
                    <PanelLeftClose aria-hidden className="size-5" />
                  ) : (
                    <PanelLeftOpen aria-hidden className="size-5" />
                  )}
                </RailButton>
              </div>
            </motion.aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col pr-[var(--safe-right)]">
            {!fullBoard && <PageHeader desktop={desktop} />}
            <main
              ref={mainRef}
              id="main-content"
              tabIndex={-1}
              className={cn(
                'min-h-0 flex-1 outline-none',
                fullBoard ? 'h-dvh flex-none' : 'pb-[var(--dock-space)] md:pb-8',
              )}
            >
              {inSettingsHub ? (
                <SettingsHub project={isProjectSettings ? project : hubProject}>
                  <Outlet />
                </SettingsHub>
              ) : (
                <Outlet />
              )}
            </main>
          </div>
        </div>
        <CommandPalette
          key={workspace?.id ?? 'none'}
          mode={palette?.mode ?? null}
          seed={palette?.seed ?? ''}
          onClose={() => setPalette(null)}
          onModeChange={(mode, seed = '') => setPalette({ mode, seed })}
          onOpenTask={context.openTask}
        />
        <AppUpdatePrompt />
        <WebUpdatePrompt />
        <ShellForms form={form} onClose={() => setForm(null)} />
        {!desktop && <ProjectSwitcher open={switcherOpen} onClose={closeSwitcher} />}
        <NewTagHost />
      </ManagementSurfaceProvider>
    </ShellContext.Provider>
  );
}

function RailButton({
  label,
  expanded,
  active,
  children,
  onClick,
  href,
  tint,
  className,
}: {
  label: string;
  expanded: boolean;
  active?: boolean;
  /** A project's color: its icon takes it, and so does the row while it is the open one. */
  tint?: string | null;
  children: ReactNode;
  onClick: () => void;
  href?: string;
  className?: string;
}) {
  const props = {
    'aria-label': label,
    'aria-current': active ? ('page' as const) : undefined,
    'data-color': tint ?? undefined,
    className: cn(
      'relative flex h-12 w-full shrink-0 items-center gap-3 rounded-2xl px-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? cn('font-semibold', tint ? 'bg-tint' : 'bg-accent')
        : 'text-muted-foreground hover:bg-accent/60',
      className,
    ),
  };
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center">{children}</span>
      <span
        aria-hidden={!expanded}
        className={cn(
          'min-w-0 truncate whitespace-nowrap transition-opacity duration-150',
          !expanded && 'opacity-0',
        )}
      >
        {label}
      </span>
    </>
  );
  // A collapsed rail shows only icons, so each names itself beside the rail.
  const hint = (control: ReactElement) => (
    <Hint label={label} side="right" disabled={expanded}>
      {control}
    </Hint>
  );
  if (href)
    return hint(
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          onClick();
        }}
      >
        {content}
      </a>,
    );
  return hint(
    <button {...props} type="button" onClick={onClick}>
      {content}
    </button>,
  );
}
