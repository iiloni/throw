import { useRouterState } from '@tanstack/react-router';
import type { Project } from '@throw/shared';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Layers,
  type LucideIcon,
  Network,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { accountLabel } from '@/components/AccountAvatar/AccountAvatar';
import { AccountList } from '@/components/AccountSwitcher/AccountList';
import { AccountSwipeButton } from '@/components/AccountSwitcher/AccountSwipeButton';
import { useDeviceAccounts } from '@/components/AccountSwitcher/deviceAccounts';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { useShell } from '@/components/AppShell/shell';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { UpdateDot } from '@/components/UpdateDot/UpdateDot';
import { springs } from '@/lib/motion';
import { UPDATE_READY_DESCRIPTION, useUpdateReady } from '@/lib/updateReady';
import { cn } from '@/lib/utils';

type View = 'projects' | 'workspaces' | 'accounts';

/** Tiles past this many arrive together, so a long list is never kept waiting. */
const STAGGERED = 8;

/**
 * The phone's project switcher: a drawer page (ADR 0009) of the workspace's projects
 * as tinted tiles, low on the screen where a thumb reaches them. Workspaces and the occasional
 * actions sit around the tiles rather than among them: the account and the workspace are quiet
 * rows above that open their own views, and settings and the trash are a footer below. A swipe
 * across the account's avatar changes to the next account on the device (ADR 0016).
 */
export function ProjectSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shell = useShell();
  const updateReady = useUpdateReady();
  const reduced = useReducedMotion() ?? false;
  const [view, setView] = useState<View>('projects');
  // Every opening starts on the projects.
  useEffect(() => {
    if (open) setView('projects');
  }, [open]);
  // Back and Escape step back to the projects before they close the switcher.
  const dismiss = useCallback(() => {
    if (view === 'projects') return false;
    setView('projects');
    return true;
  }, [view]);

  /** Closes the switcher, then acts: a form opening takes the drawer's page in its place. */
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  /*
   * A board switch leaves the switcher open until the next board commits, inside the page's
   * cross-fade. Closing first put the half-closed drawer and its scrim in the outgoing snapshot,
   * held while the board rendered and then dropped in a frame; this way the page dissolves from
   * what was on screen while the live drawer closes over it. The router sets the resolved
   * location inside the transition; `location` changes as navigation starts, before the
   * outgoing snapshot is taken. `leaving` is the page a switch waits to leave.
   */
  const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
  const leaving = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (leaving.current === null || leaving.current === (pathname ?? '')) return;
    leaving.current = null;
    onClose();
  }, [pathname, onClose]);
  const switchTo = (action: (() => void) | false) => () => {
    if (!action) return onClose();
    leaving.current = pathname ?? '';
    action();
  };
  const { workspace, project } = shell;
  const { accounts, current: account } = useDeviceAccounts();
  const titles: Record<View, string> = {
    projects: 'Projects',
    workspaces: 'Workspaces',
    accounts: 'Accounts',
  };

  return (
    <ManagementSurface open={open} title={titles[view]} onClose={onClose} dismiss={dismiss} fit>
      <AnimatedHeight anchor="top">
        {/* The view leaving lifts out of the flow, so the height springs to the arriving one. */}
        <div className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={view}
              data-switcher-view={view}
              className="flex flex-col gap-4 pt-1 pb-1"
              initial={{ opacity: 0, x: reduced ? 0 : view === 'projects' ? -24 : 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{
                opacity: 0,
                x: reduced ? 0 : view === 'projects' ? -24 : 24,
                transition: { duration: reduced ? 0 : 0.14, ease: 'easeIn' },
              }}
              transition={reduced ? { duration: 0 } : springs.smooth}
            >
              {view === 'projects' ? (
                <>
                  {account && (
                    <AccountSwipeButton
                      accounts={accounts}
                      current={account}
                      avatarClassName="mx-0.5"
                      onClick={() => setView('accounts')}
                      className="-mx-1 flex min-h-12 items-center gap-3 rounded-2xl px-1 text-left outline-none transition-colors active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-muted-foreground text-xs">Account</span>
                        <span className="block truncate font-semibold text-sm">
                          {accountLabel(account)}
                        </span>
                      </span>
                      {accounts.length > 1 && (
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {accounts.length}
                        </span>
                      )}
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </AccountSwipeButton>
                  )}
                  {workspace && (
                    <button
                      type="button"
                      aria-label={`Workspace: ${workspace.name}`}
                      onClick={() => setView('workspaces')}
                      className="-mx-1 flex min-h-12 items-center gap-3 rounded-2xl px-1 text-left outline-none transition-colors active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.07]">
                        <Layers aria-hidden className="size-[1.125rem]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-muted-foreground text-xs">Workspace</span>
                        <span className="block truncate font-semibold text-sm">
                          {workspace.name}
                        </span>
                      </span>
                      {shell.workspaces.length > 1 && (
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {shell.workspaces.length}
                        </span>
                      )}
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  )}
                  {workspace && (
                    <nav
                      aria-label="Projects in this workspace"
                      className="grid grid-cols-2 gap-2.5"
                    >
                      <AllProjectsTile
                        active={shell.crossBoard}
                        onSelect={switchTo(!shell.crossBoard && shell.goBoard)}
                      />
                      {shell.projects.map((item, index) => (
                        <ProjectTile
                          key={item.id}
                          project={item}
                          index={index}
                          reduced={reduced}
                          active={!shell.crossBoard && !shell.settings && project?.id === item.id}
                          onSelect={switchTo(
                            (shell.crossBoard || shell.settings || project?.id !== item.id) &&
                              (() => shell.selectProject(item.workspaceId, item.id)),
                          )}
                        />
                      ))}
                      <Tile
                        label="New project"
                        className="border border-foreground/15 border-dashed text-muted-foreground"
                        onSelect={then(() => shell.openForm({ kind: 'new-project', workspace }))}
                      >
                        <Plus aria-hidden className="size-5" />
                        <span className="font-medium text-sm">New project</span>
                      </Tile>
                    </nav>
                  )}
                  <div className="grid auto-cols-fr grid-flow-col gap-1.5 border-t pt-3">
                    {shell.board && (
                      <FooterAction
                        icon={shell.view === 'graph' ? Columns3 : Network}
                        label={shell.view === 'graph' ? 'Show the board' : 'Dependency graph'}
                        short={shell.view === 'graph' ? 'Board' : 'Graph'}
                        onSelect={then(() =>
                          shell.showView(shell.view === 'graph' ? 'board' : 'graph'),
                        )}
                      />
                    )}
                    {project && !shell.crossBoard && (
                      <FooterAction
                        icon={SlidersHorizontal}
                        label="Project settings"
                        onSelect={then(() => shell.goProjectSettings(project))}
                      />
                    )}
                    {workspace && (
                      <FooterAction
                        icon={Trash2}
                        label="Workspace trash"
                        short="Trash"
                        onSelect={then(() => shell.goTrash())}
                      />
                    )}
                    <FooterAction
                      icon={Settings}
                      label="Settings"
                      description={updateReady ? UPDATE_READY_DESCRIPTION : undefined}
                      badge={<UpdateDot className="absolute -top-0.5 -right-0.5" />}
                      onSelect={then(shell.goSettings)}
                    />
                  </div>
                </>
              ) : view === 'accounts' ? (
                <>
                  <BackToProjects onSelect={() => setView('projects')} />
                  <AccountList onLeave={onClose} className="-mx-1" />
                </>
              ) : (
                <>
                  <BackToProjects onSelect={() => setView('projects')} />
                  <ul aria-label="Workspaces" className="flex flex-col gap-1.5">
                    {shell.workspaces.map((item) => {
                      const active = item.id === workspace?.id;
                      return (
                        <li key={item.id}>
                          <Row
                            icon={Layers}
                            active={active}
                            onSelect={switchTo(!active && (() => shell.selectWorkspace(item.id)))}
                          >
                            {item.name}
                          </Row>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-col gap-1.5 border-t pt-3">
                    <Row
                      icon={Plus}
                      quiet
                      onSelect={then(() => shell.openForm({ kind: 'new-workspace' }))}
                    >
                      New workspace
                    </Row>
                    {workspace && (
                      <Row
                        icon={Pencil}
                        quiet
                        onSelect={then(() => shell.openForm({ kind: 'edit-workspace', workspace }))}
                      >
                        Rename workspace
                      </Row>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </AnimatedHeight>
    </ManagementSurface>
  );
}

const tileClass =
  'relative flex min-h-[6.5rem] flex-col items-start justify-between gap-3 rounded-[1.25rem] p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Tile({
  label,
  active,
  tint,
  className,
  onSelect,
  children,
}: {
  label: string;
  active?: boolean;
  tint?: string;
  className?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-color={tint}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      transition={springs.snappy}
      onClick={onSelect}
      className={cn(tileClass, className)}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-foreground text-background"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
    </motion.button>
  );
}

function AllProjectsTile({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return (
    <Tile
      label="All projects"
      active={active}
      onSelect={onSelect}
      className={cn(
        'col-span-2 min-h-14 flex-row items-center justify-start bg-foreground/[0.06] py-2.5',
        active && 'bg-foreground/[0.1] shadow-[inset_0_1px_0_var(--glass-highlight)]',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/70">
        <Columns3 aria-hidden className="size-[1.125rem]" />
      </span>
      <span className="font-semibold text-sm">All projects</span>
    </Tile>
  );
}

function ProjectTile({
  project,
  active,
  index,
  reduced,
  onSelect,
}: {
  project: Project;
  active: boolean;
  index: number;
  reduced: boolean;
  onSelect: () => void;
}) {
  return (
    // The tiles settle in one after another as the drawer rises, as Catch's grid does.
    <motion.div
      className="flex"
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...springs.smooth, delay: Math.min(index, STAGGERED) * 0.025 }}
    >
      <Tile
        label={project.name}
        active={active}
        tint={project.color}
        onSelect={onSelect}
        className={cn(
          'w-full bg-tint',
          active &&
            'shadow-[inset_0_0_0_2px_var(--tint-accent),inset_0_1px_0_var(--glass-highlight)]',
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-background/55 text-tint-accent shadow-[inset_0_1px_0_var(--glass-highlight)]">
          <ProjectIcon name={project.icon} className="size-5" />
        </span>
        <span className="flex w-full min-w-0 flex-col">
          <span className="line-clamp-2 break-words font-semibold text-[0.9375rem] leading-snug">
            {project.name}
          </span>
          {project.key && (
            <span aria-hidden className="font-medium text-tint-accent text-xs tracking-wide">
              {project.key}
            </span>
          )}
        </span>
      </Tile>
    </motion.div>
  );
}

function FooterAction({
  icon: Icon,
  label,
  short,
  description,
  badge,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  /** What the button shows where the footer is narrow; the full label still names it. */
  short?: string;
  /** Status the badge shows, for assistive technology. */
  description?: string;
  /** A mark over the icon's corner, such as `UpdateDot`. */
  badge?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={short ? label : undefined}
      aria-description={description}
      onClick={onSelect}
      className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-muted-foreground text-xs outline-none transition-colors active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative flex">
        <Icon aria-hidden className="size-5" />
        {badge}
      </span>
      {/* Large text wraps to a second line rather than cutting the label off. */}
      <span className="line-clamp-2 max-w-full text-balance text-center leading-tight">
        {short ?? label}
      </span>
    </button>
  );
}

function BackToProjects({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="-ml-1 flex min-h-11 items-center gap-1 self-start rounded-xl pr-3 pl-1 text-muted-foreground text-sm outline-none active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft aria-hidden className="size-4" />
      Projects
    </button>
  );
}

function Row({
  icon: Icon,
  active,
  quiet,
  onSelect,
  children,
}: {
  icon: LucideIcon;
  active?: boolean;
  quiet?: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-foreground/[0.08] font-semibold shadow-[inset_0_1px_0_var(--glass-highlight)]'
          : 'active:bg-foreground/[0.06]',
        quiet && 'text-muted-foreground',
      )}
    >
      <Icon aria-hidden className="size-[1.125rem] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check aria-hidden className="size-4 shrink-0" />}
    </button>
  );
}
