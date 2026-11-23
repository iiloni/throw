import { createFileRoute } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { Trash } from '@/components/Trash/Trash';
import { useLocalRowsReady } from '@/lib/collections';
import { useLaunchScreenReady } from '@/lib/launchScreen';

export const Route = createFileRoute('/_app/w/$workspaceId/trash')({
  staticData: { holdsLaunchScreen: true },
  component: Page,
});

/** As the project routes do: an empty list must mean an empty trash, not one still loading. */
function Page() {
  const shell = useShell();
  const localReady = useLocalRowsReady('workspaces', 'projects');
  const waiting = shell.awaitingWorkspaces;
  useLaunchScreenReady(localReady && !waiting && !shell.workspace);
  if (waiting)
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
