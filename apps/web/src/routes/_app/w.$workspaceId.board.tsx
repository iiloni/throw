import { createFileRoute } from '@tanstack/react-router';
import { Columns3 } from 'lucide-react';
import { useCallback } from 'react';
import { z } from 'zod';
import { useShell, viewSchema } from '@/components/AppShell/shell';
import { WorkspaceBoard } from '@/components/Board/WorkspaceBoard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useLocalRowsReady } from '@/lib/collections';
import { useLaunchScreenReady } from '@/lib/launchScreen';

export const Route = createFileRoute('/_app/w/$workspaceId/board')({
  staticData: { holdsLaunchScreen: true },
  validateSearch: (search): { view: z.infer<typeof viewSchema>; task?: string } => ({
    view: viewSchema.exclude(['backlog']).catch('board').parse(search.view),
    task: z.uuid().optional().catch(undefined).parse(search.task),
  }),
  component: CrossProjectBoard,
});
function CrossProjectBoard() {
  const { task } = Route.useSearch();
  const shell = useShell();
  const { openPalette } = shell;
  const onCreate = useCallback(() => openPalette('capture'), [openPalette]);
  const onSearch = useCallback(() => openPalette('search'), [openPalette]);
  const localReady = useLocalRowsReady('workspaces', 'projects');
  const waiting = shell.awaitingWorkspaces || shell.awaitingProjects;
  useLaunchScreenReady(localReady && !waiting && (!shell.workspace || shell.projects.length === 0));
  if (waiting)
    return (
      <p role="status" className="p-6 text-center text-muted-foreground">
        Loading…
      </p>
    );
  if (!shell.workspace)
    return (
      <EmptyState icon={Columns3} title="Workspace unavailable">
        Choose another workspace from the navigation menu.
      </EmptyState>
    );
  if (shell.projects.length === 0)
    return (
      <EmptyState icon={Columns3} title="One board, every project">
        Work across this workspace comes together here once it has a project.
      </EmptyState>
    );
  return (
    <WorkspaceBoard
      key={shell.workspace.id}
      workspaceId={shell.workspace.id}
      projects={shell.projects}
      task={task}
      onCreate={onCreate}
      onSearch={onSearch}
    />
  );
}
