import { createFileRoute } from '@tanstack/react-router';
import { useShell } from '@/components/AppShell/shell';
import { ProjectSettings } from '@/components/ProjectSettings/ProjectSettings';
import { useLocalRowsReady } from '@/lib/collections';
import { useLaunchScreenReady } from '@/lib/launchScreen';
import { type SettingsSection, settingsSectionSchema } from '@/lib/projectSettings';

export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId_/settings')({
  staticData: { holdsLaunchScreen: true },
  validateSearch: (search): { section?: SettingsSection } => ({
    section: settingsSectionSchema.catch('general').parse(search.section),
  }),
  component: Page,
});
function Page() {
  const shell = useShell();
  const { section = 'general' } = Route.useSearch();
  const localReady = useLocalRowsReady('workspaces', 'projects');
  const waiting = shell.awaitingWorkspaces || shell.awaitingProjects;
  useLaunchScreenReady(localReady && !waiting && !shell.project);
  if (waiting)
    return (
      <p role="status" className="p-6">
        Loading…
      </p>
    );
  if (!shell.project)
    return (
      <p className="p-6">Project unavailable. Choose another project from the navigation menu.</p>
    );
  return <ProjectSettings key={shell.project.id} project={shell.project} section={section} />;
}
