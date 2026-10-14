import { createFileRoute } from '@tanstack/react-router';
import { Folder, Search } from 'lucide-react';
import { useShell, viewSchema } from '@/components/AppShell/shell';
import { ProjectBoard } from '@/components/Board/ProjectBoard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useMedia } from '@/lib/media';

export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId')({
  validateSearch: (search) => ({ view: viewSchema.catch('board').parse(search.view) }),
  component: ProjectPage,
});
function ProjectPage() {
  const shell = useShell();
  const desktop = useMedia('(min-width: 768px)');
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
  if (shell.view === 'search' && desktop)
    return (
      <EmptyState key="search" icon={Search} title="Search">
        Search will help you find work across this workspace.
      </EmptyState>
    );
  return <ProjectBoard key={shell.project.id} project={shell.project} />;
}
