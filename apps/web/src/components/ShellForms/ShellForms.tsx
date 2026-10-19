import { COLORS, type Color, type Project, type Workspace } from '@throw/shared';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { PROJECT_ICON_LABELS, ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createProject, trashProject, updateProject } from '@/lib/projects';
import { cn } from '@/lib/utils';
import { createWorkspace, renameWorkspace } from '@/lib/workspaces';

export type ShellForm =
  | { kind: 'new-project'; workspace: Workspace }
  | { kind: 'edit-project'; project: Project }
  | { kind: 'new-workspace' }
  | { kind: 'edit-workspace'; workspace: Workspace };
export function ShellForms({ form, onClose }: { form: ShellForm | null; onClose: () => void }) {
  const title = !form
    ? ''
    : form.kind === 'new-project'
      ? 'New project'
      : form.kind === 'edit-project'
        ? 'Edit project'
        : form.kind === 'new-workspace'
          ? 'New workspace'
          : 'Rename workspace';
  return (
    <ManagementSurface open={form !== null} onClose={onClose} title={title}>
      {form && (
        <ManagementForm
          key={
            form.kind +
            ('project' in form ? form.project.id : 'workspace' in form ? form.workspace.id : '')
          }
          form={form}
          onClose={onClose}
        />
      )}
    </ManagementSurface>
  );
}
export function ManagementForm({ form, onClose }: { form: ShellForm; onClose: () => void }) {
  const shell = useShell();
  const project = form.kind === 'edit-project' ? form.project : undefined;
  const isProject = form.kind === 'new-project' || form.kind === 'edit-project';
  const used = new Set(shell.projects.map((item) => item.color));
  const [name, setName] = useState(
    project?.name ?? (form.kind === 'edit-workspace' ? form.workspace.name : ''),
  );
  const [color, setColor] = useState<Color>(
    project?.color ?? COLORS.find((item) => !used.has(item)) ?? 'amber',
  );
  const [icon, setIcon] = useState<string | null>(project?.icon ?? null);
  const [iconQuery, setIconQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    switch (form.kind) {
      case 'new-project': {
        const id = createProject(form.workspace.id, name, { color, icon });
        shell.selectProject(form.workspace.id, id);
        break;
      }
      case 'edit-project':
        updateProject(form.project.id, { name, color, icon });
        break;
      case 'new-workspace':
        shell.selectWorkspace(createWorkspace(name));
        break;
      case 'edit-workspace':
        renameWorkspace(form.workspace.id, name);
        break;
    }
    onClose();
  }
  if (confirming && project)
    return (
      <div className="flex flex-col gap-5 pb-1">
        <h2 className="font-semibold">Delete {project.name}?</h2>
        <p className="text-muted-foreground text-sm">
          This moves the project and its tasks to the trash.
        </p>
        <div className="flex justify-end gap-2">
          <Button autoFocus variant="ghost" onClick={() => setConfirming(false)}>
            Keep project
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              trashProject(project.id);
              shell.selectWorkspace(project.workspaceId);
              onClose();
            }}
          >
            Delete project
          </Button>
        </div>
      </div>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-1">
      <div className="space-y-2">
        <label htmlFor="shell-name" className="text-sm font-medium">
          {isProject ? 'Project name' : 'Workspace name'}
        </label>
        <Input
          id="shell-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={isProject ? 80 : 60}
          required
        />
      </div>
      {isProject && (
        <>
          <ColorPicker value={color} onChange={setColor} />
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">Project icon</legend>
            <Input
              aria-label="Find an icon"
              placeholder="Find an icon"
              value={iconQuery}
              onChange={(event) => setIconQuery(event.target.value)}
              className="mb-2"
            />
            <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto p-1" data-color={color}>
              {!iconQuery && (
                <button
                  type="button"
                  aria-label="Default icon"
                  aria-pressed={icon === null}
                  onClick={() => setIcon(null)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    icon === null && 'bg-tint text-tint-accent',
                  )}
                >
                  <ProjectIcon className="size-5" />
                </button>
              )}
              {Object.entries(PROJECT_ICON_LABELS)
                .filter(([, label]) => label.toLowerCase().includes(iconQuery.toLowerCase()))
                .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${label} icon`}
                    title={label}
                    aria-pressed={icon === value}
                    onClick={() => setIcon(value)}
                    className={cn(
                      'flex size-10 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                      icon === value && 'bg-tint text-tint-accent',
                    )}
                  >
                    <ProjectIcon name={value} className="size-5" />
                  </button>
                ))}
            </div>
          </fieldset>
        </>
      )}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {project && (
          <Button
            type="button"
            variant="ghost"
            aria-label="Delete project"
            className="mr-auto text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {form.kind.startsWith('new-') ? 'Create' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
