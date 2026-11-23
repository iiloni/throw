import { Check, ChevronDown, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { Hint } from '@/components/Hint/Hint';
import { cn } from '@/lib/utils';

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent';

export function ShellMenu({
  expanded = true,
  phone = false,
  titleClassName,
}: {
  expanded?: boolean;
  phone?: boolean;
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
  const trigger = (
    <button
      type="button"
      data-shell-menu
      data-shell-title={phone ? '' : undefined}
      aria-label={phone ? 'Switch project or workspace' : 'Switch workspace'}
      aria-haspopup={phone ? 'dialog' : undefined}
      aria-expanded={phone ? (shell.switcher?.open ?? false) : undefined}
      onClick={phone ? () => shell.switcher?.show() : undefined}
      className={
        phone
          ? 'flex min-h-11 max-w-full items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'flex h-12 w-full items-center gap-3 rounded-2xl px-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring'
      }
    >
      {!phone && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.08]">
          <Layers className="size-5" aria-hidden />
        </span>
      )}
      {(phone || expanded) && (
        <>
          <span
            className={
              phone
                ? cn(
                    'truncate font-display font-extrabold text-[clamp(1.5rem,6vw,2.625rem)] leading-tight tracking-[-0.03em]',
                    titleClassName,
                  )
                : 'min-w-0 flex-1 truncate text-left font-semibold text-sm'
            }
          >
            {title}
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </button>
  );
  /*
    The label names the action, so the hint gives the name it acts on: always to a screen
    reader, and on screen where the rail hides it or the title is cut short.
  */
  const hinted = (control: ReactElement) => (
    <Hint
      label={title}
      side={phone ? 'bottom' : 'right'}
      whenTruncated={phone || expanded}
      describe
    >
      {control}
    </Hint>
  );
  // A phone switches in its drawer (the shell's ProjectSwitcher), low where a thumb reaches.
  if (phone) return hinted(trigger);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{hinted(trigger)}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="shell-menu glass-thick z-40 max-h-[min(70dvh,36rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-3xl p-2"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]')) event.preventDefault();
          }}
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
