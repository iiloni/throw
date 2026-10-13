import { Check, ChevronDown, Columns3, Layers, Pencil, Plus, Settings2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none focus:bg-foreground/[0.08] data-[highlighted]:bg-foreground/[0.08]';

export function ShellMenu({
  expanded = true,
  phone = false,
}: {
  expanded?: boolean;
  phone?: boolean;
}) {
  const shell = useShell();
  const title = phone
    ? shell.settings
      ? 'Settings'
      : shell.crossBoard
        ? 'All projects'
        : (shell.project?.name ?? shell.workspace?.name ?? 'Throw')
    : (shell.workspace?.name ?? 'Throw');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-shell-menu
          data-shell-title={phone ? '' : undefined}
          aria-label={phone ? 'Switch project or workspace' : 'Switch workspace'}
          title={title}
          className={
            phone
              ? 'flex min-h-11 max-w-full items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex h-12 w-full items-center gap-3 rounded-2xl px-2 outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring'
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
                    ? 'truncate font-display font-extrabold text-[clamp(1.5rem,6vw,2.625rem)] leading-tight tracking-[-0.03em]'
                    : 'min-w-0 flex-1 truncate text-left font-semibold text-sm'
                }
              >
                {title}
              </span>
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenu.Trigger>
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
          {phone && (
            <>
              <DropdownMenu.Separator className="my-2 border-t" />
              <DropdownMenu.Label className="px-3 pb-1 text-xs text-muted-foreground">
                Projects
              </DropdownMenu.Label>
              {shell.projects.map((project) => (
                <MenuItem
                  key={project.id}
                  onSelect={() => shell.selectProject(project.workspaceId, project.id)}
                >
                  <span
                    data-color={project.color}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint text-tint-accent"
                  >
                    <ProjectIcon name={project.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {shell.project?.id === project.id && <Check aria-hidden className="size-4" />}
                </MenuItem>
              ))}
              {shell.workspace && (
                <MenuItem
                  onSelect={() =>
                    shell.openForm({ kind: 'new-project', workspace: shell.workspace! })
                  }
                >
                  <Plus aria-hidden className="size-4" />
                  New project
                </MenuItem>
              )}
              {shell.workspace && (
                <MenuItem onSelect={shell.goBoard}>
                  <Columns3 aria-hidden className="size-4" />
                  All projects
                </MenuItem>
              )}
              <DropdownMenu.Separator className="my-2 border-t" />
              <MenuItem onSelect={shell.goSettings}>
                <Settings2 aria-hidden className="size-4" />
                Settings
              </MenuItem>
            </>
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
