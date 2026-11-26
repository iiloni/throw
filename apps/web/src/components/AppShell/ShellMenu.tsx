import { Check, ChevronDown, Columns3, Layers, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { type HTMLAttributes, type ReactNode, type Ref, useState } from 'react';
import { MAX_PULL, switcherPull } from '@/components/AppShell/SwitcherPull';
import { useShell } from '@/components/AppShell/shell';
import { Hint } from '@/components/Hint/Hint';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { ScrollBox } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent';

export function ShellMenu({
  expanded = true,
  phone = false,
}: {
  expanded?: boolean;
  phone?: boolean;
  /** @deprecated The phone title sizes itself; kept until the boards stop passing it. */
  titleClassName?: string;
}) {
  const shell = useShell();
  const title = phone
    ? shell.settings
      ? 'Settings'
      : shell.crossBoard
        ? 'All projects'
        : (shell.project?.name ?? shell.workspace?.name ?? 'Throw')
    : (shell.workspace?.name ?? 'Throw');
  // A phone switches in its drawer (the shell's ProjectSwitcher), low where a thumb reaches.
  if (phone)
    return (
      <Hint label={title} side="bottom" whenTruncated describe>
        <PhoneTitle title={title} />
      </Hint>
    );
  const trigger = (
    <button
      type="button"
      data-shell-menu
      aria-label="Switch workspace"
      className="flex h-12 w-full items-center gap-3 rounded-2xl px-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.08]">
        <Layers className="size-5" aria-hidden />
      </span>
      {expanded && (
        <>
          <span className="min-w-0 flex-1 truncate text-left font-semibold text-sm">{title}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </button>
  );
  return (
    <DropdownMenu.Root>
      {/*
        The label names the action, so the hint gives the name it acts on: always to a screen
        reader, and on screen where the rail hides it or the title is cut short.
      */}
      <DropdownMenu.Trigger asChild>
        <Hint label={title} side="right" whenTruncated={expanded} describe>
          {trigger}
        </Hint>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="shell-menu glass-thick z-40 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-3xl"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]')) event.preventDefault();
          }}
        >
          <ScrollBox
            className="max-h-[min(70dvh,36rem)] [--scrollbar-inset:1rem]"
            viewportClassName="p-2"
          >
            <DropdownMenu.Label className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
              Workspaces
            </DropdownMenu.Label>
            {shell.workspaces.map((workspace) => (
              <MenuItem key={workspace.id} onSelect={() => shell.selectWorkspace(workspace.id)}>
                <Layers aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {shell.workspace?.id === workspace.id && <Check aria-hidden className="size-4" />}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => shell.openForm({ kind: 'new-workspace' })}>
              <Plus aria-hidden className="size-4" />
              New workspace
            </MenuItem>
            {shell.workspace && (
              <MenuItem
                onSelect={() =>
                  shell.openForm({ kind: 'edit-workspace', workspace: shell.workspace! })
                }
              >
                <Pencil aria-hidden className="size-4" />
                Rename workspace
              </MenuItem>
            )}
            {shell.workspace && (
              <MenuItem onSelect={() => shell.goTrash()}>
                <Trash2 aria-hidden className="size-4" />
                Workspace trash
              </MenuItem>
            )}
          </ScrollBox>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
function MenuItem({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={itemClass}>
      {children}
    </DropdownMenu.Item>
  );
}

/**
 * The phone board's title: what is open, as a tinted chip with its project's icon, opening
 * the switcher. A pull down from the top of the board draws the chip after the finger and
 * names what letting go does beneath it (`SwitcherPull`), so the title is the pull's cue.
 */
function PhoneTitle({
  title,
  ref,
  ...props
}: { title: string; ref?: Ref<HTMLButtonElement> } & HTMLAttributes<HTMLButtonElement>) {
  const shell = useShell();
  const reduced = useReducedMotion() ?? false;
  const armed = switcherPull.armed.use();
  const { travel } = switcherPull;
  const y = useTransform(travel, (at) => (reduced ? 0 : at * 0.4));
  const turn = useTransform(travel, [0, MAX_PULL], [0, 180]);
  const cue = useTransform(travel, reduced ? [12, 40] : [6, 24], [0, 1]);
  const cueY = useTransform(travel, [6, 24], reduced ? [0, 0] : [-6, 0]);
  // Mounted only while drawn, so the heading's text stays the title alone.
  const [pulling, setPulling] = useState(() => travel.get() > 0);
  useMotionValueEvent(travel, 'change', (at) => setPulling(at > 0));
  const project = !shell.settings && !shell.crossBoard ? shell.project : undefined;
  const Icon = shell.settings ? Settings : shell.crossBoard ? Columns3 : Layers;
  return (
    <motion.span className="relative z-20 flex min-w-0 max-w-full" style={{ y }}>
      <button
        {...props}
        ref={ref}
        type="button"
        data-shell-menu
        data-shell-title=""
        data-pull-armed={armed ? '' : undefined}
        aria-label="Switch project or workspace"
        aria-haspopup="dialog"
        aria-expanded={shell.switcher?.open ?? false}
        onClick={() => shell.switcher?.show()}
        className={cn(
          'relative -left-1 flex min-h-11 min-w-0 max-w-full items-center gap-2.5 rounded-2xl py-1 pr-1.5 pl-1 text-left outline-none transition-[background-color,box-shadow] duration-200 active:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring',
          // Drawn down over the column's name, the chip takes the glass so it reads on top.
          pulling && 'glass',
        )}
      >
        <span
          data-color={project?.color}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_var(--glass-highlight)]',
            project ? 'bg-tint text-tint-accent' : 'bg-foreground/[0.08]',
          )}
        >
          {project ? (
            <ProjectIcon name={project.icon} className="size-[1.125rem]" />
          ) : (
            <Icon aria-hidden className="size-[1.125rem]" />
          )}
        </span>
        <span className="truncate font-display font-extrabold text-[1.5rem] leading-tight tracking-[-0.03em]">
          {title}
        </span>
        <motion.span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
            armed ? 'bg-foreground text-background' : 'bg-foreground/[0.07] text-muted-foreground',
          )}
          style={{ rotate: reduced ? 0 : turn }}
        >
          <ChevronDown className="size-3.5" strokeWidth={2.5} />
        </motion.span>
      </button>
      {/* What letting go does, under the chip it came from. On the glass, as it overlaps the board. */}
      {pulling && (
        <motion.span
          aria-hidden
          data-switcher-pull-cue=""
          className="glass pointer-events-none absolute top-full left-0 mt-2 flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 font-medium text-sm"
          style={{ opacity: cue, y: cueY }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={armed ? 'release' : 'pull'}
              initial={{ opacity: 0, filter: 'blur(4px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{
                opacity: 0,
                filter: 'blur(4px)',
                transition: { duration: reduced ? 0 : 0.14 },
              }}
              transition={reduced ? { duration: 0 } : springs.smooth}
            >
              {armed ? 'Release to switch projects' : 'Pull to switch projects'}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      )}
    </motion.span>
  );
}
