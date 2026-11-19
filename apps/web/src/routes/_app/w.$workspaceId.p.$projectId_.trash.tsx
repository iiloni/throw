import { createFileRoute, Link } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { ProjectSettingsFrame } from '@/components/ProjectSettings/ProjectSettings';
import { Trash } from '@/components/Trash/Trash';
import { useProjects } from '@/lib/collections';

export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId_/trash')({
  component: Page,
});
function Page() {
  const shell = useShell();
  const { workspaceId, projectId } = Route.useParams();
  const { projects } = useProjects();
  if (shell.awaitingWorkspaces || shell.awaitingProjects)
    return (
      <p role="status" className="p-6">
        Loading…
      </p>
    );
  // A trashed project's tasks are managed with the project, from the workspace trash.
  if (!shell.project && projects.some((item) => item.id === projectId && item.deletedAt))
    return (
      <p className="p-6">
        This project is in the trash.{' '}
        <Link to="/w/$workspaceId/trash" params={{ workspaceId }} className="text-brand-link">
          Restore it from the workspace trash
        </Link>{' '}
        to manage its tasks.
      </p>
    );
  if (!shell.project)
    return (
      <p className="p-6">Project unavailable. Choose another project from the navigation menu.</p>
    );
  return (
    <ProjectSettingsFrame project={shell.project} current="trash">
      <Trash key={shell.project.id} projectId={shell.project.id} embedded />
    </ProjectSettingsFrame>
  );
}
