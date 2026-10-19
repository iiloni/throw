import { STATUS_CATEGORIES, type Status, type StatusCategory, type Task } from '@throw/shared';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { statusRemovalIssue, statusUsage } from '@/lib/projectSettings';
import {
  createStatus,
  deleteStatus,
  makeDefaultStatus,
  moveStatus,
  renameStatus,
} from '@/lib/statuses';

const categoryNames = {
  backlog: 'Backlog',
  active: 'Active',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function StatusSettings({
  projectId,
  statuses,
  tasks,
}: {
  projectId: string;
  statuses: Status[];
  tasks: Task[];
}) {
  const [editor, setEditor] = useState<{ category: StatusCategory; status?: Status } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const removed = statuses.find((status) => status.id === deleting);
  const removalIssue =
    removed && statusRemovalIssue(removed, statuses, statusUsage(removed, tasks));
  return (
    <section aria-label="Statuses" className="space-y-7">
      <div>
        <h2 className="font-display text-2xl font-semibold">Statuses</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Categories are fixed when you create a status. Every category keeps a default and at least
          one status. Task counts include the trash.
        </p>
      </div>
      {STATUS_CATEGORIES.map((category) => {
        const siblings = statuses.filter((status) => status.category === category);
        return (
          <section key={category} aria-label={`${categoryNames[category]} statuses`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{categoryNames[category]}</h3>
              <Button variant="ghost" onClick={() => setEditor({ category })}>
                Add status<span className="sr-only"> to {categoryNames[category]}</span>
              </Button>
            </div>
            <ul className="divide-y border-y">
              {siblings.map((status, index) => {
                const count = statusUsage(status, tasks);
                const issue = statusRemovalIssue(status, siblings, count);
                return (
                  <li key={status.id} className="py-3" aria-label={status.name}>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="min-w-0 flex-1 break-words font-medium text-sm">
                        {status.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {count} {count === 1 ? 'task' : 'tasks'}
                      </span>
                      <IconButton
                        label={`Rename ${status.name}`}
                        className="size-11"
                        onClick={() => setEditor({ category, status })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={`Move ${status.name} up`}
                        className="size-11"
                        disabled={index === 0}
                        onClick={() =>
                          moveStatus(
                            status.id,
                            siblings[index - 2] ?? null,
                            siblings[index - 1] ?? null,
                          )
                        }
                      >
                        <ArrowUp />
                      </IconButton>
                      <IconButton
                        label={`Move ${status.name} down`}
                        className="size-11"
                        disabled={index === siblings.length - 1}
                        onClick={() =>
                          moveStatus(
                            status.id,
                            siblings[index + 1] ?? null,
                            siblings[index + 2] ?? null,
                          )
                        }
                      >
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        label={`Delete ${status.name}`}
                        className="size-11 text-destructive"
                        disabled={!!issue}
                        aria-describedby={issue ? `rule-${status.id}` : undefined}
                        onClick={() => setDeleting(status.id)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={status.isDefault}
                        onClick={() => makeDefaultStatus(status.id)}
                        disabled={status.isDefault}
                      >
                        {status.isDefault ? 'Default' : 'Make default'}
                      </Button>
                      {issue && (
                        <p
                          id={`rule-${status.id}`}
                          className="flex-1 text-xs text-muted-foreground"
                        >
                          {issue}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editor && (
        <ManagementSurface
          open
          title={editor.status ? 'Rename status' : `Add ${categoryNames[editor.category]} status`}
          onClose={() => setEditor(null)}
        >
          <StatusForm
            key={editor.status?.id ?? editor.category}
            initial={editor.status?.name ?? ''}
            onCancel={() => setEditor(null)}
            onSave={(name) => {
              if (editor.status) renameStatus(editor.status.id, name);
              else createStatus(projectId, name, editor.category);
              setEditor(null);
            }}
          />
        </ManagementSurface>
      )}
      <ManagementSurface open={!!removed} title="Delete status?" onClose={() => setDeleting(null)}>
        <p className="mb-5 break-words text-sm text-muted-foreground">
          {removalIssue ??
            `“${removed?.name ?? ''}” will be removed. Tasks and their history are kept.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!!removalIssue}
            onClick={() => {
              if (removed) setError(deleteStatus(removed.id) ?? '');
              setDeleting(null);
            }}
          >
            Delete status
          </Button>
        </div>
      </ManagementSurface>
    </section>
  );
}
function StatusForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <label htmlFor="status-name" className="flex flex-col gap-2 text-sm font-medium">
        Status name
        <Input
          id="status-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          required
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          Save status
        </Button>
      </div>
    </form>
  );
}
