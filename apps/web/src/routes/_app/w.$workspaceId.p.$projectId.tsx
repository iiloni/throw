import { createFileRoute } from '@tanstack/react-router';
import { Columns3, Folder, LayoutDashboard, Search } from 'lucide-react';
import { useShell, viewSchema } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId')({
  validateSearch: (search) => ({ view: viewSchema.catch('board').parse(search.view) }),
  component: ProjectPage,
});
function ProjectPage() {
  const shell = useShell();
  if (shell.awaitingWorkspaces || shell.awaitingProjects)
    return (
      <p role="status" className="p-6 text-center text-muted-foreground">
        Loading…
      </p>
    );
  if (!shell.project)
    return (
      <EmptyState icon={Folder} title="Project unavailable">
        It may have been deleted. Choose another project from the navigation menu.
      </EmptyState>
    );
  if (shell.view === 'search')
    return (
      <EmptyState key="search" icon={Search} title="Search">
        Search will help you find work across this workspace.
      </EmptyState>
    );
  if (shell.view === 'backlog')
    return (
      <EmptyState key="backlog" icon={LayoutDashboard} title="Backlog">
        Ideas and work waiting to begin will live here.
      </EmptyState>
    );
  return (
    <EmptyState key="board" icon={Columns3} title="Project board">
      Work in progress will live here, arranged by status.
    </EmptyState>
  );
}
