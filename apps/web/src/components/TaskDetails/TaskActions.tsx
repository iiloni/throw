import { isClosedCategory, type Status, type Task } from '@throw/shared';
import { Check, Copy, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { getServerUrl } from '@/lib/serverUrl';
import { restoreTask, sendTask, trashTask } from '@/lib/tasks';

export function TaskActions({ task, statuses }: { task: Task; statuses: Status[] }) {
  const [link, setLink] = useState<string | null>(null);
  const status = statuses.find((row) => row.id === task.statusId);
  const closed = status && isClosedCategory(status.category);
  const target = statuses.find(
    (row) => row.category === (closed ? 'backlog' : 'done') && row.isDefault,
  );
  const url = () =>
    new URL(`/w/${task.workspaceId}/p/${task.projectId}?view=board&task=${task.id}`, getServerUrl())
      .href;
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton label="Task actions" className="size-11">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="shell-menu glass-thick z-50 w-56 rounded-2xl p-2"
          >
            {target && (
              <DropdownMenu.Item
                onSelect={() => sendTask(task.id, target.id)}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
              >
                {closed ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                {closed ? 'Reopen task' : 'Close task'}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              onSelect={() => (task.deletedAt ? restoreTask(task.id) : trashTask(task.id))}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
            >
              {task.deletedAt ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />}
              {task.deletedAt ? 'Restore task' : 'Move to trash'}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => {
                const href = url();
                if (!navigator.clipboard) setLink(href);
                else
                  void navigator.clipboard.writeText(href).then(
                    () => {
                      setLink(null);
                      toast.success('Task link copied');
                    },
                    () => setLink(href),
                  );
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
            >
              <Copy className="size-4" />
              Copy task link
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {link && (
        <label className="max-w-48 text-xs">
          Copy this task link
          <input
            aria-label="Task link"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 w-full rounded bg-background p-2 text-sm"
          />
        </label>
      )}
    </>
  );
}
