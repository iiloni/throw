import type { Project } from '@throw/shared';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Layers,
  type LucideIcon,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { useShell } from '@/components/AppShell/shell';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

type View = 'projects' | 'workspaces';

/** Tiles past this many arrive together, so a long list is never kept waiting. */
const STAGGERED = 8;

/**
 * The phone's project switcher: a drawer page (ADR 0009) of the workspace's projects
 * as tinted tiles, low on the screen where a thumb reaches them. Workspaces and the occasional
 * actions sit around the tiles rather than among them: the workspace is a quiet row above that
 * opens its own view, and settings and the trash are a footer below.
 */
export function ProjectSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shell = useShell();
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
  const { workspace, project } = shell;

  return (
    <ManagementSurface
      open={open}
      title={view === 'projects' ? 'Projects' : 'Workspaces'}
      onClose={onClose}
      dismiss={dismiss}
      fit
    >
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
                        onSelect={then(() => {
                          if (!shell.crossBoard) shell.goBoard();
                        })}
                      />
                      {shell.projects.map((item, index) => (
                        <ProjectTile
                          key={item.id}
                          project={item}
                          index={index}
                          reduced={reduced}
                          active={!shell.crossBoard && !shell.settings && project?.id === item.id}
                          onSelect={then(() => {
                            if (shell.crossBoard || shell.settings || project?.id !== item.id)
                              shell.selectProject(item.workspaceId, item.id);
                          })}
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
                      onSelect={then(shell.goSettings)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setView('projects')}
                    className="-ml-1 flex min-h-11 items-center gap-1 self-start rounded-xl pr-3 pl-1 text-muted-foreground text-sm outline-none active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronLeft aria-hidden className="size-4" />
                    Projects
                  </button>
                  <ul aria-label="Workspaces" className="flex flex-col gap-1.5">
                    {shell.workspaces.map((item) => {
                      const active = item.id === workspace?.id;
                      return (
                        <li key={item.id}>
                          <Row
                            icon={Layers}
                            active={active}
                            onSelect={then(() => {
                              if (!active) shell.selectWorkspace(item.id);
                            })}
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
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  /** What the button shows where the footer is narrow; the full label still names it. */
  short?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={short ? label : undefined}
      onClick={onSelect}
      className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-muted-foreground text-xs outline-none transition-colors active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="size-5" />
      {/* Large text wraps to a second line rather than cutting the label off. */}
      <span className="line-clamp-2 max-w-full text-balance text-center leading-tight">
        {short ?? label}
      </span>
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
