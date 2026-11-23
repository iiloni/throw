import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { useLocalRowsReady } from '@/lib/collections';
import { useLaunchScreenReady } from '@/lib/launchScreen';

export const Route = createFileRoute('/_app/settings')({
  staticData: { holdsLaunchScreen: true },
  component: SettingsPage,
});

function SettingsPage() {
  const shell = useShell();
  const localReady = useLocalRowsReady('workspaces', 'projects');
  useLaunchScreenReady(localReady && !shell.awaitingWorkspaces && !shell.awaitingProjects);
  return <Outlet />;
}
