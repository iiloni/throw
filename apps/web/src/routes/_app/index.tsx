import { createFileRoute } from '@tanstack/react-router';
import { comparePositions, type Project, type Workspace } from '@throw/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjects, useWorkspaces } from '@/lib/collections';
import { createProject, deleteProject, projectsIn } from '@/lib/projects';
import { useAwaitingSync } from '@/lib/syncStatus';

/**
 * A placeholder home page: every workspace with its projects. It exists to exercise sync and
 * the outbox end to end until the board in docs/spec.md replaces it.
 */
export const Route = createFileRoute('/_app/')({ component: HomePage });

function HomePage() {
  const { workspaces, isLoading } = useWorkspaces();
  const { projects } = useProjects();
  const awaitingSync = useAwaitingSync(isLoading, workspaces.length);
  const ordered = [...workspaces].sort((a, b) => comparePositions(a.position, b.position));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
      {awaitingSync && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!awaitingSync && ordered.length === 0 && (
        <p className="text-muted-foreground text-sm">No workspaces yet.</p>
      )}
      {ordered.map((workspace) => (
        <WorkspaceSection
          key={workspace.id}
          workspace={workspace}
          projects={projectsIn(projects, workspace.id)}
        />
      ))}
    </main>
  );
}

function WorkspaceSection({ workspace, projects }: { workspace: Workspace; projects: Project[] }) {
  const [name, setName] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    createProject(workspace.id, name);
    setName('');
  }

  return (
    <section aria-labelledby={`workspace-${workspace.id}`} className="flex flex-col gap-3">
      <h1 id={`workspace-${workspace.id}`} className="font-bold font-display text-2xl">
        {workspace.name}
      </h1>
      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">No projects yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {projects.map((project) => (
            <li
              key={project.id}
              data-color={project.color}
              className="flex items-center gap-3 rounded-lg border bg-tint px-3 py-2"
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-tint-accent" />
              <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${project.name}`}
                onClick={() => deleteProject(project.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="New project"
          aria-label={`New project in ${workspace.name}`}
        />
        <Button type="submit" disabled={!name.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}
