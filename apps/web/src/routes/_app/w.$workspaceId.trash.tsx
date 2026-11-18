import { createFileRoute } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { Trash } from '@/components/Trash/Trash';

export const Route = createFileRoute('/_app/w/$workspaceId/trash')({ component: Page });

/** As the project routes do: an empty list must mean an empty trash, not one still loading. */
function Page() {
  const shell = useShell();
  if (shell.awaitingWorkspaces)
    return (
      <p role="status" className="p-6">
        Loading…
      </p>
    );
  if (!shell.workspace)
    return (
      <p className="p-6">
        Workspace unavailable. Choose another workspace from the navigation menu.
      </p>
    );
  return <Trash key={shell.workspace.id} />;
}
