import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { Folder } from 'lucide-react';
import { useEffect } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_app/w/$workspaceId/')({ component: WorkspaceHome });
function WorkspaceHome() {
  const shell = useShell();
  const params = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigating = useRouterState({ select: (state) => state.isLoading });
  const first =
    shell.projects.find(
      (project) => project.id === shell.remembered.projects[shell.workspace?.id ?? ''],
    ) ?? shell.projects[0];
  const navigate = useNavigate();
  const workspaceId = first?.workspaceId;
  const projectId = first?.id;
  const waiting = shell.awaitingWorkspaces || shell.awaitingProjects;
  useEffect(() => {
    if (
      !navigating &&
      pathname.replace(/\/$/, '') === `/w/${params.workspaceId}` &&
      !waiting &&
      workspaceId &&
      projectId
    )
      void navigate({
        to: '/w/$workspaceId/p/$projectId',
        params: { workspaceId, projectId },
        search: { view: 'board' },
        replace: true,
      });
  }, [navigating, pathname, params.workspaceId, waiting, workspaceId, projectId, navigate]);
  if (waiting || first)
    return (
      <p role="status" className="p-6 text-center text-muted-foreground">
        Loading…
      </p>
    );
  return (
    <EmptyState
      icon={Folder}
      title={shell.workspace ? 'Your first project' : 'Workspace unavailable'}
    >
      {shell.workspace ? (
        <>
          <p>A project brings related work together.</p>
          <Button
            className="mt-4"
            onClick={() => shell.openForm({ kind: 'new-project', workspace: shell.workspace! })}
          >
            Create project
          </Button>
        </>
      ) : (
        <p>Choose another workspace from the navigation menu.</p>
      )}
    </EmptyState>
  );
}
