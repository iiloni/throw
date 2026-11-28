import { DEFAULT_PRIORITY_NAMES, EMPTY_PRIORITY_NAMES, type Project } from '@throw/shared';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useShell } from '@/components/AppShell/shell';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { GithubConnectionSettings } from '@/components/GithubConnection/GithubConnection';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { ProjectIconPicker } from '@/components/ProjectIconPicker/ProjectIconPicker';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { TagManager } from '@/components/TagManager/TagManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalRowsReady, useProjects, useStatuses, useTasks } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { useLaunchScreenReady } from '@/lib/launchScreen';
import { type SettingsSection as ProjectSection, projectKeyIssue } from '@/lib/projectSettings';
import {
  changeProjectKey,
  restoreProject,
  setPriorityNames,
  trashProject,
  updateProject,
} from '@/lib/projects';
import { statusesOf } from '@/lib/statuses';
import { useAwaitingSync } from '@/lib/syncStatus';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { StatusSettings } from './StatusSettings';

export function ProjectSettings({
  project,
  section,
}: {
  project: Project;
  section: ProjectSection;
}) {
  const { statuses, isLoading } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const ownStatuses = statusesOf(statuses, project.id);
  const awaitingStatuses = useAwaitingSync(isLoading, ownStatuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, tasks.length);
  const awaiting = awaitingStatuses || awaitingTasks;
  const localReady = useLocalRowsReady(
    'workspaces',
    'projects',
    ...(section === 'statuses'
      ? ['statuses', 'tasks']
      : section === 'tags'
        ? ['tags']
        : section === 'github'
          ? ['statuses']
          : []),
  );
  useLaunchScreenReady(localReady && (section !== 'statuses' || !awaiting));
  return (
    <>
      {section === 'general' && (
        <div className="flex flex-col gap-6">
          <ProjectAppearance project={project} />
          <ProjectKey project={project} />
          <DeleteProject project={project} />
        </div>
      )}
      {section === 'statuses' &&
        (awaiting ? (
          <p role="status">Loading statuses…</p>
        ) : (
          <StatusSettings projectId={project.id} statuses={ownStatuses} tasks={tasks} />
        ))}
      {section === 'priorities' && <PrioritySettings project={project} />}
      {section === 'tags' && <TagManager projectId={project.id} titled={false} />}
      {section === 'github' && (
        <GithubConnectionSettings
          projectId={project.id}
          statuses={awaitingStatuses ? null : ownStatuses}
        />
      )}
    </>
  );
}

/**
 * Name, color and icon, saved as they change, as the app's settings are. A name is saved
 * when it is left or entered, and Escape returns to the saved one.
 */
function ProjectAppearance({ project }: { project: Project }) {
  const [draft, setDraft] = useState<string | null>(null);
  const unsaved = draft !== null && draft.trim() !== project.name;
  useEffect(() => (unsaved ? holdUpdateReload() : undefined), [unsaved]);
  const commit = () => {
    if (draft === null) return;
    const name = draft.trim();
    if (name && name !== project.name) updateProject(project.id, { name });
    setDraft(null);
  };
  return (
    <SettingsSection
      title="Appearance"
      description="How the project shows in your navigation and on the cross-project board."
    >
      <div className="flex flex-col gap-5 p-4" data-color={project.color}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="project-name" className="font-medium text-sm">
            Project name
          </label>
          <Input
            id="project-name"
            value={draft ?? project.name}
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && draft !== null) {
                event.preventDefault();
                setDraft(null);
              }
            }}
          />
        </form>
        <ColorPicker
          value={project.color}
          onChange={(color) => {
            if (color !== project.color) updateProject(project.id, { color });
          }}
        />
        <ProjectIconPicker
          value={project.icon}
          color={project.color}
          onChange={(icon) => {
            if (icon !== project.icon) updateProject(project.id, { icon });
          }}
        />
      </div>
    </SettingsSection>
  );
}

function DeleteProject({ project }: { project: Project }) {
  const shell = useShell();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete project
        </button>
      </div>
      <ManagementSurface
        open={confirming}
        title={`Delete ${project.name}?`}
        fit
        onClose={() => setConfirming(false)}
      >
        <p className="mb-5 text-muted-foreground text-sm">
          This moves the project and its tasks to the workspace trash, where it can be restored.
        </p>
        <div className="flex justify-end gap-2 pb-1">
          <Button autoFocus variant="ghost" onClick={() => setConfirming(false)}>
            Keep project
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              haptics.warning();
              trashProject(project.id);
              setConfirming(false);
              shell.selectWorkspace(project.workspaceId, project.id);
              // Deleting leaves the project, so the way back is offered where the user lands.
              const { id, workspaceId } = project;
              toast(`${project.name} moved to the trash`, {
                action: {
                  label: 'Undo',
                  onClick: () => {
                    haptics.success();
                    restoreProject(id);
                    shell.selectProject(workspaceId, id);
                  },
                },
              });
            }}
          >
            Delete project
          </Button>
        </div>
      </ManagementSurface>
    </>
  );
}

function ProjectKey({ project }: { project: Project }) {
  const { projects } = useProjects();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const key = draft ?? project.key ?? '';
  const issue = projectKeyIssue(project, key, projects);
  return (
    <SettingsSection
      title="Task identifiers"
      description={`The prefix of every task identifier, such as ${project.key ?? 'KEY'}-12.`}
    >
      <form
        className="space-y-3 p-4"
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
              haptics.success();
              setDraft(null);
              setConfirming(false);
            }}
          >
            Change key
          </Button>
        </div>
      </ManagementSurface>
    </SettingsSection>
  );
}
function PrioritySettings({ project }: { project: Project }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const names = draft ?? project.priorityNames;
  return (
    <section className="space-y-5">
      <p className="px-1 text-sm text-muted-foreground">
        Five fixed ranks, highest first. Empty names use the defaults. New tasks start at rank 3.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPriorityNames(
            project.id,
            names.map((name) => name.trim()),
          );
          haptics.success();
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
          <Button type="button" variant="ghost" onClick={() => setDraft([...EMPTY_PRIORITY_NAMES])}>
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
