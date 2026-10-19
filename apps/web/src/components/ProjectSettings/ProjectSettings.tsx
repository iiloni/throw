import { Link } from '@tanstack/react-router';
import { DEFAULT_PRIORITY_NAMES, type Priority, type Project } from '@throw/shared';
import { useState } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { ManagementForm } from '@/components/ShellForms/ShellForms';
import { TagManager } from '@/components/TagManager/TagManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjects, useStatuses, useTasks } from '@/lib/collections';
import {
  projectKeyIssue,
  type SettingsSection,
  settingsSectionSchema,
} from '@/lib/projectSettings';
import { changeProjectKey, renamePriority } from '@/lib/projects';
import { statusesOf } from '@/lib/statuses';
import { useAwaitingSync } from '@/lib/syncStatus';
import { StatusSettings } from './StatusSettings';

export function ProjectSettings({
  project,
  section,
  onSectionChange,
}: {
  project: Project;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { statuses, isLoading } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const ownStatuses = statusesOf(statuses, project.id);
  const awaitingStatuses = useAwaitingSync(isLoading, ownStatuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, tasks.length);
  const awaiting = awaitingStatuses || awaitingTasks;
  return (
    <div className="mx-auto max-w-3xl px-5 pb-10 md:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">Project settings</h2>
        <Link
          to="/w/$workspaceId/p/$projectId"
          params={{ workspaceId: project.workspaceId, projectId: project.id }}
          search={{ view: 'board' }}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to board
        </Link>
      </div>
      <nav
        aria-label="Project settings sections"
        className="mb-8 flex flex-wrap gap-1 border-b pb-3"
      >
        {settingsSectionSchema.options.map((tab) => (
          <Button
            key={tab}
            variant="ghost"
            aria-current={section === tab ? 'page' : undefined}
            className={section === tab ? 'h-11 bg-accent px-3' : 'h-11 px-3'}
            onClick={() => onSectionChange(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
        <Link
          to="/w/$workspaceId/p/$projectId/trash"
          params={{ workspaceId: project.workspaceId, projectId: project.id }}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-muted-foreground hover:bg-accent"
        >
          Trash
        </Link>
      </nav>
      {section === 'general' && (
        <div className="space-y-8">
          <section className="flex items-start justify-between gap-4 border-b pb-6">
            <div>
              <h2 className="font-display text-xl font-semibold">Appearance</h2>
              <p className="mt-2 break-words text-sm text-muted-foreground">{project.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Name, colour and icon in your navigation.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit project
            </Button>
          </section>
          <ProjectKey project={project} />
        </div>
      )}
      {section === 'statuses' &&
        (awaiting ? (
          <p role="status">Loading statuses…</p>
        ) : (
          <StatusSettings projectId={project.id} statuses={ownStatuses} tasks={tasks} />
        ))}
      {section === 'priorities' && <PrioritySettings project={project} />}
      {section === 'tags' && <TagManager projectId={project.id} />}
      <ManagementSurface open={editing} title="Edit project" onClose={() => setEditing(false)}>
        {editing && (
          <ManagementForm
            form={{ kind: 'edit-project', project }}
            onClose={() => setEditing(false)}
          />
        )}
      </ManagementSurface>
    </div>
  );
}
function ProjectKey({ project }: { project: Project }) {
  const { projects } = useProjects();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const key = draft ?? project.key ?? '';
  const issue = projectKeyIssue(project, key, projects);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Project key</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The prefix of every task identifier, such as {project.key ?? 'KEY'}-12.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!issue && key !== project.key) setConfirming(true);
        }}
      >
        <label htmlFor="project-key" className="flex max-w-xs flex-col gap-2 text-sm font-medium">
          Project key
          <Input
            id="project-key"
            value={key}
            disabled={project.key === null}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            aria-invalid={!!issue}
            aria-describedby={issue ? 'key-rules key-issue' : 'key-rules'}
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p id="key-rules" className="text-sm text-muted-foreground">
          1–6 letters A–Z or digits, starting with a letter. Keys must be unique in this workspace,
          including its trash.
        </p>
        {issue && (
          <p id="key-issue" role="alert" className="text-sm text-destructive">
            {issue}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Changing the key changes all existing identifiers. Old identifiers do not redirect.
        </p>
        <Button type="submit" disabled={!!issue || key === project.key}>
          Change key
        </Button>
      </form>
      <ManagementSurface
        open={confirming}
        title="Change project key?"
        onClose={() => setConfirming(false)}
      >
        <p className="mb-5 text-sm text-muted-foreground">
          Every {project.key}-… identifier becomes {key}-…. Old identifiers do not redirect. Task
          numbers stay the same.
        </p>
        {issue && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {issue}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            disabled={!!issue || key === project.key}
            onClick={() => {
              changeProjectKey(project.id, key);
              setDraft(null);
              setConfirming(false);
            }}
          >
            Change key
          </Button>
        </div>
      </ManagementSurface>
    </section>
  );
}
function PrioritySettings({ project }: { project: Project }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const names = draft ?? project.priorityNames;
  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-semibold">Priority names</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Five fixed ranks, highest first. Empty names use the defaults. New tasks start at rank 3.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          names.forEach((name, index) => {
            if (name !== project.priorityNames[index])
              renamePriority(project.id, (index + 1) as Priority, name.trim());
          });
          setDraft(null);
        }}
      >
        {DEFAULT_PRIORITY_NAMES.map((name, index) => (
          <label
            htmlFor={`priority-${index}`}
            key={name}
            className="flex items-center gap-4 text-sm"
          >
            <span className="w-24 shrink-0 text-muted-foreground">
              {index + 1}. {name}
            </span>
            <Input
              id={`priority-${index}`}
              aria-label={`Rank ${index + 1} name`}
              value={names[index]}
              placeholder={name}
              maxLength={30}
              onChange={(event) =>
                setDraft(names.map((current, i) => (i === index ? event.target.value : current)))
              }
            />
          </label>
        ))}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setDraft(['', '', '', '', ''])}>
            Use default names
          </Button>
          <Button
            type="submit"
            disabled={names.every((name, index) => name === project.priorityNames[index])}
          >
            Save priority names
          </Button>
        </div>
      </form>
    </section>
  );
}
