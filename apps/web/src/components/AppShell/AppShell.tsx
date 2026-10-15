import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { comparePositions } from '@throw/shared';
import { Columns3, PanelLeftClose, PanelLeftOpen, Plus, Settings2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { z } from 'zod';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import {
  navigationSchema,
  type ProjectView,
  ShellContext,
  type ShellState,
  viewSchema,
} from '@/components/AppShell/shell';
import { AppUpdatePrompt } from '@/components/AppUpdatePrompt/AppUpdatePrompt';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { Dock } from '@/components/Dock/Dock';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { type ShellForm, ShellForms } from '@/components/ShellForms/ShellForms';
import { WebUpdatePrompt } from '@/components/WebUpdatePrompt/WebUpdatePrompt';
import { getSignedInUser } from '@/lib/auth';
import { useProjects, useWorkspaces } from '@/lib/collections';
import { useMedia } from '@/lib/media';
import { springs } from '@/lib/motion';
import { projectsIn } from '@/lib/projects';
import { usePersistentState } from '@/lib/storage';
import { useAwaitingSync } from '@/lib/syncStatus';
import { watchUpdates } from '@/lib/updates';
import { updateReloadBlocked } from '@/lib/useUpdateReloadBlocked';
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
  const desktop = useMedia('(min-width: 768px)');
  const expanded = railChoice ?? wide;
  const reduced = useReducedMotion();
  const [form, setForm] = useState<ShellForm | null>(null);
  useEffect(() => {
    updateReloadBlocked.set(form !== null);
    return () => updateReloadBlocked.set(false);
  }, [form]);
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
  const crossBoard = location.pathname.endsWith('/board');
  const settings = location.pathname === '/settings';

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
  ) {
    remember({ workspaceId, projects: { ...remembered.projects, [workspaceId]: projectId } });
    void navigate({
      to: '/w/$workspaceId/p/$projectId',
      params: { workspaceId, projectId },
      search: { view: nextView },
      replace,
    });
  }
  function selectWorkspace(id: string) {
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
    settings,
    selectProject,
    selectWorkspace,
    openForm: setForm,
    goBoard,
    selectBoardView: (view) => {
      if (workspace)
        void navigate({
          to: '/w/$workspaceId/board',
          params: { workspaceId: workspace.id },
          search: { view },
          replace: true,
        });
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
      <div className="flex min-h-dvh">
        {desktop && (
          <motion.aside
            aria-label="Navigation rail"
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
            <nav
              aria-label="Projects"
              className="mt-5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3"
            >
              {projects.map((item) => (
                <RailButton
                  key={item.id}
                  label={item.name}
                  href={`/w/${item.workspaceId}/p/${item.id}?view=board`}
                  expanded={expanded}
                  active={project?.id === item.id}
                  onClick={() => selectProject(item.workspaceId, item.id)}
                >
                  <span
                    data-color={item.color}
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tint text-tint-accent"
                  >
                    <ProjectIcon name={item.icon} className="size-5" />
                  </span>
                </RailButton>
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
              <RailButton
                label="Settings"
                href="/settings"
                expanded={expanded}
                active={settings}
                onClick={context.goSettings}
              >
                <Settings2 aria-hidden className="size-5" />
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
          <PageHeader desktop={desktop} />
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 pb-[var(--dock-space)] outline-none md:pb-8"
          >
            <Outlet />
          </main>
        </div>
      </div>
      {!desktop && <Dock />}
      <AppUpdatePrompt />
      <WebUpdatePrompt />
      <ShellForms form={form} onClose={() => setForm(null)} />
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
}: {
  label: string;
  expanded: boolean;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
  href?: string;
}) {
  const props = {
    title: expanded ? undefined : label,
    'aria-label': label,
    'aria-current': active ? ('page' as const) : undefined,
    className: cn(
      'relative flex h-12 w-full shrink-0 items-center gap-3 rounded-2xl px-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-accent/60',
    ),
  };
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center">{children}</span>
      <span
        aria-hidden={!expanded}
        className={cn(
          'truncate whitespace-nowrap transition-opacity duration-150',
          !expanded && 'opacity-0',
        )}
      >
        {label}
      </span>
    </>
  );
  if (href)
    return (
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
      </a>
    );
  return (
    <button {...props} type="button" onClick={onClick}>
      {content}
    </button>
  );
}
