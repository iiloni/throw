import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { useEffect } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_app/')({ component: Home });
function Home() {
  const shell = useShell();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigating = useRouterState({ select: (state) => state.isLoading });
  // A remembered route remains valid while its rows hydrate or Electric replays its log.
  const workspaceId = shell.remembered.workspaceId ?? shell.workspace?.id;
  useEffect(() => {
    if (pathname === '/' && !navigating && workspaceId)
      void navigate({ to: '/w/$workspaceId', params: { workspaceId }, replace: true });
  }, [pathname, navigating, workspaceId, navigate]);
  if (shell.awaitingWorkspaces || workspaceId)
    return (
      <p role="status" className="p-6 text-center text-muted-foreground">
        Loading…
      </p>
    );
  return (
    <EmptyState icon={Layers} title="Create a workspace">
      <p>Give your projects a place to live.</p>
      <Button className="mt-4" onClick={() => shell.openForm({ kind: 'new-workspace' })}>
        New workspace
      </Button>
    </EmptyState>
  );
}
