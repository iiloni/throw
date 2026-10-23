import { createFileRoute } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { Trash } from '@/components/Trash/Trash';
export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId_/trash')({
  component: Page,
});
function Page() {
  const shell = useShell();
  if (shell.awaitingWorkspaces || shell.awaitingProjects)
    return (
      <p role="status" className="p-6">
        Loading…
      </p>
    );
  if (!shell.project)
    return (
      <p className="p-6">Project unavailable. Choose another project from the navigation menu.</p>
    );
  return <Trash key={shell.project.id} projectId={shell.project.id} />;
}
