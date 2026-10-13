import { Ellipsis } from 'lucide-react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { useShell } from '@/components/AppShell/shell';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';

/** Catch's centred display title and quiet corner controls, without note selection or scroll collapse. */
export function PageHeader({ desktop }: { desktop: boolean }) {
  const shell = useShell();
  const title = shell.settings
    ? 'Settings'
    : shell.crossBoard
      ? 'All projects'
      : (shell.project?.name ?? shell.workspace?.name ?? 'Throw');
  return (
    <header className="relative px-5 pt-[calc(var(--safe-top)+1rem)] pb-4 md:px-8 md:pt-[calc(var(--safe-top)+2rem)] md:pb-6">
      <div className="flex min-h-8 items-center justify-between gap-3 text-xs text-muted-foreground">
        {desktop ? (
          // The lockup carries its own clear space; pull it back so the mark meets the title's edge.
          <div className="-ml-1.5 min-w-0">
            <BrandLockup orientation="horizontal" iconSize={32} />
          </div>
        ) : (
          <span className="truncate">{shell.workspace?.name}</span>
        )}
        <SyncIndicator />
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-3">
        {desktop && shell.project && (
          <span
            data-color={shell.project.color}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-tint-accent"
          >
            <ProjectIcon name={shell.project.icon} className="size-6" />
          </span>
        )}
        <h1
          aria-label={title}
          className="min-w-0 flex-1 font-display font-extrabold text-[clamp(1.5rem,3vw,2.625rem)] leading-tight tracking-[-0.03em]"
        >
          {desktop ? (
            <span data-shell-title tabIndex={-1} className="block truncate outline-none">
              {title}
            </span>
          ) : (
            <ShellMenu phone />
          )}
        </h1>
        {shell.project && (
          <IconButton
            label="Edit project"
            className="size-11 shrink-0"
            onClick={() => shell.openForm({ kind: 'edit-project', project: shell.project! })}
          >
            <Ellipsis />
          </IconButton>
        )}
      </div>
    </header>
  );
}
