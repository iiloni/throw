import { createFileRoute } from '@tanstack/react-router';
import { Columns3, Search } from 'lucide-react';
import { useShell, viewSchema } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export const Route = createFileRoute('/_app/w/$workspaceId/board')({
  validateSearch: (search) => ({
    view: viewSchema.exclude(['backlog']).catch('board').parse(search.view),
  }),
  component: CrossProjectBoard,
});
function CrossProjectBoard() {
  const shell = useShell();
  if (shell.view === 'search' && shell.workspace)
    return (
      <EmptyState key="search" icon={Search} title="Search">
        Search will help you find work across this workspace.
      </EmptyState>
    );
  return (
    <EmptyState
      icon={Columns3}
      title={shell.workspace ? 'One board, every project' : 'Workspace unavailable'}
    >
      {shell.workspace
        ? 'Work across this workspace will come together here, grouped by category.'
        : 'Choose another workspace from the navigation menu.'}
    </EmptyState>
  );
}
