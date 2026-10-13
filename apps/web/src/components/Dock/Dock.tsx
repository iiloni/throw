import { Columns3, LayoutDashboard, Search } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { type PointerEvent, useRef, useState } from 'react';
import { type ProjectView, useShell } from '@/components/AppShell/shell';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const TABS = [
  { view: 'backlog', label: 'Backlog', icon: LayoutDashboard },
  { view: 'board', label: 'Board', icon: Columns3 },
  { view: 'search', label: 'Search', icon: Search },
] as const;

/** Catch's glass tabs: the indicator follows a held finger; releasing selects that tab. */
export function Dock() {
  const shell = useShell();
  const nav = useRef<HTMLElement>(null);
  const [pressed, setPressed] = useState<ProjectView | null>(null);
  const reduced = useReducedMotion();
  const project =
    shell.project ??
    shell.projects.find(
      (item) => item.id === shell.remembered.projects[shell.workspace?.id ?? ''],
    ) ??
    shell.projects[0];
  if (!project || (!shell.project && !shell.crossBoard)) return null;
  function tabAt(clientX: number) {
    const box = nav.current?.getBoundingClientRect();
    if (!box) return shell.view;
    return TABS[Math.min(2, Math.max(0, Math.floor(((clientX - box.left) / box.width) * 3)))]!.view;
  }
  function go(view: ProjectView) {
    if (shell.crossBoard && view !== 'backlog') shell.selectBoardView(view);
    else shell.selectProject(project!.workspaceId, project!.id, view, true);
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(tabAt(event.clientX));
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-30 flex justify-center px-[max(var(--safe-left),0.75rem)]">
      <LayoutGroup id="phone-dock">
        <motion.div
          initial={{ y: reduced ? 0 : 24 }}
          animate={{ y: 0 }}
          transition={springs.smooth}
          className="glass pointer-events-auto relative h-[var(--dock-height)] w-full max-w-md rounded-[var(--dock-radius)]"
        >
          <nav
            ref={nav}
            aria-label="Project views"
            className="absolute inset-0 grid touch-none select-none grid-cols-3 p-1 [-webkit-touch-callout:none]"
            onPointerDown={pointerDown}
            onPointerMove={(event) => {
              if (pressed) setPressed(tabAt(event.clientX));
            }}
            onPointerUp={(event) => {
              if (pressed) go(tabAt(event.clientX));
              setPressed(null);
            }}
            onPointerCancel={() => setPressed(null)}
            onLostPointerCapture={() => setPressed(null)}
            onContextMenu={(event) => event.preventDefault()}
          >
            {TABS.map(({ view, label, icon: Icon }) => (
              <a
                key={view}
                href={
                  shell.crossBoard && view !== 'backlog'
                    ? `/w/${project.workspaceId}/board?view=${view}`
                    : `/w/${project.workspaceId}/p/${project.id}?view=${view}`
                }
                aria-label={label}
                aria-current={shell.view === view ? 'page' : undefined}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  if (event.detail === 0) go(view);
                }}
                className={cn(
                  'relative z-0 flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                  (pressed ?? shell.view) === view ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {(pressed ?? shell.view) === view && (
                  <motion.span
                    layoutId="dock-indicator"
                    aria-hidden
                    className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-accent shadow-[inset_0_1px_0_var(--glass-highlight)]"
                    animate={{ scale: pressed && !reduced ? 1.06 : 1 }}
                    transition={reduced ? { duration: 0 } : springs.snappy}
                  />
                )}
                <motion.span
                  animate={{ scale: pressed === view && !reduced ? 1.12 : 1 }}
                  transition={springs.snappy}
                >
                  <Icon className="size-6" aria-hidden />
                </motion.span>
              </a>
            ))}
          </nav>
        </motion.div>
      </LayoutGroup>
    </div>
  );
}
