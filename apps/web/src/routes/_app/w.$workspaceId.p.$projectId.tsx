import { createFileRoute } from '@tanstack/react-router';
import { Folder } from 'lucide-react';
import { z } from 'zod';
import { useShell, viewSchema } from '@/components/AppShell/shell';
import { ProjectBoard } from '@/components/Board/ProjectBoard';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export const Route = createFileRoute('/_app/w/$workspaceId/p/$projectId')({
  validateSearch: (search): { view: z.infer<typeof viewSchema>; task?: string } => ({
    view: viewSchema.catch('board').parse(search.view),
    task: z.uuid().optional().catch(undefined).parse(search.task),
  }),
  component: ProjectPage,
});
function ProjectPage() {
  const { task } = Route.useSearch();
  const shell = useShell();
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
  return <ProjectBoard key={shell.project.id} project={shell.project} initialTaskId={task} />;
}
