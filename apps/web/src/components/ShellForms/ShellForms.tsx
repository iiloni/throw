import { COLORS, type Color, type Workspace } from '@throw/shared';
import { type FormEvent, useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { ProjectIconPicker } from '@/components/ProjectIconPicker/ProjectIconPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createProject } from '@/lib/projects';
import { createWorkspace, renameWorkspace } from '@/lib/workspaces';

export type ShellForm =
  | { kind: 'new-project'; workspace: Workspace }
  | { kind: 'new-workspace' }
  | { kind: 'edit-workspace'; workspace: Workspace };
export function ShellForms({ form, onClose }: { form: ShellForm | null; onClose: () => void }) {
  const title = !form
    ? ''
    : form.kind === 'new-project'
      ? 'New project'
      : form.kind === 'new-workspace'
        ? 'New workspace'
        : 'Rename workspace';
  return (
    <ManagementSurface open={form !== null} onClose={onClose} title={title}>
      {form && (
        <ManagementForm
          key={form.kind + ('workspace' in form ? form.workspace.id : '')}
          form={form}
          onClose={onClose}
        />
      )}
    </ManagementSurface>
  );
}
export function ManagementForm({ form, onClose }: { form: ShellForm; onClose: () => void }) {
  const shell = useShell();
  const isProject = form.kind === 'new-project';
  const used = new Set(shell.projects.map((item) => item.color));
  const [name, setName] = useState(form.kind === 'edit-workspace' ? form.workspace.name : '');
  const [color, setColor] = useState<Color>(COLORS.find((item) => !used.has(item)) ?? 'amber');
  const [icon, setIcon] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    switch (form.kind) {
      case 'new-project': {
        const id = createProject(form.workspace.id, name, { color, icon });
        shell.selectProject(form.workspace.id, id);
        break;
      }
      case 'new-workspace':
        shell.selectWorkspace(createWorkspace(name));
        break;
      case 'edit-workspace':
        renameWorkspace(form.workspace.id, name);
        break;
    }
    onClose();
  }
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
          <ProjectIconPicker value={icon} color={color} onChange={setIcon} />
        </>
      )}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
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
