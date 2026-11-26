import type { Project } from '@throw/shared';
import { ExternalLink, type LucideIcon, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { type ShellState, useShell } from '@/components/AppShell/shell';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { pagePath } from '@/lib/auth';

type ProjectAction = { key: string; label: string; icon: LucideIcon; onSelect: () => void };

/** The board a project opens at, as its rail link is written. */
export function projectBoardPath(project: Project) {
  return `/w/${project.workspaceId}/p/${project.id}?view=board`;
}

/**
 * What a project row offers, in its rail menu and on a right click alike. The first group goes
 * to the project's pages, the second acts on the project.
 */
export function projectActions(shell: ShellState, project: Project): ProjectAction[][] {
  return [
    [
      {
        key: 'settings',
        label: 'Project settings',
        icon: SlidersHorizontal,
        onSelect: () => shell.goProjectSettings(project),
      },
      {
        key: 'trash',
        label: 'Project trash',
        icon: Trash2,
        onSelect: () => shell.goTrash(project),
      },
    ],
    [
      {
        key: 'rename',
        label: 'Rename…',
        icon: Pencil,
        onSelect: () => shell.openForm({ kind: 'edit-project', project }),
      },
      {
        key: 'new-tab',
        label: 'Open in new tab',
        icon: ExternalLink,
        // Prefixed, so the new tab opens with this tab's account (ADR 0016).
        onSelect: () => window.open(pagePath(projectBoardPath(project)), '_blank', 'noopener'),
      },
    ],
  ];
}

const dropdownItemClass =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent';

/** The project row's `…` menu in the expanded rail. */
export function ProjectDropdownItems({ project }: { project: Project }) {
  const shell = useShell();
  return projectActions(shell, project).map((group, index) => (
    <DropdownMenu.Group key={group[0]?.key}>
      {index > 0 && <DropdownMenu.Separator className="-mx-2 my-1.5 h-px bg-border" />}
      {group.map(({ key, label, icon: Icon, onSelect }) => (
        <DropdownMenu.Item key={key} className={dropdownItemClass} onSelect={onSelect}>
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </DropdownMenu.Item>
      ))}
    </DropdownMenu.Group>
  ));
}

/** A right click on a project's rail row, expanded or collapsed, offers the same actions. */
export function ProjectContextMenu({
  project,
  children,
}: {
  project: Project;
  children: ReactNode;
}) {
  const shell = useShell();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${project.name} actions`} data-project-menu={project.id}>
        <ContextMenuLabel>{project.name}</ContextMenuLabel>
        {projectActions(shell, project).map((group, index) => (
          <ContextMenuGroup key={group[0]?.key}>
            {index > 0 && <ContextMenuSeparator />}
            {group.map(({ key, label, icon: Icon, onSelect }) => (
              <ContextMenuItem key={key} onSelect={onSelect}>
                <Icon aria-hidden />
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
