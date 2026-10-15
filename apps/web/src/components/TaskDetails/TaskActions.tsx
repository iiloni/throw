import { isClosedCategory, type Status, type Task } from '@throw/shared';
import { Check, Copy, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { Button } from '@/components/ui/button';
import { useBackHandler } from '@/lib/backButton';
import { getServerUrl } from '@/lib/serverUrl';
import { restoreTask, sendTask, trashTask } from '@/lib/tasks';

export function TaskActions({ task, statuses }: { task: Task; statuses: Status[] }) {
  const [link, setLink] = useState<string | null>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const openingLink = useRef(false);
  const showLink = (href: string) => {
    openingLink.current = true;
    setLink(href);
  };
  const closeLink = () => {
    openingLink.current = false;
    setLink(null);
  };
  useBackHandler(link !== null, closeLink);
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
          <IconButton ref={actionsRef} label="Task actions" className="size-11">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (openingLink.current) event.preventDefault();
            }}
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
                if (!navigator.clipboard) showLink(href);
                else
                  void navigator.clipboard.writeText(href).then(
                    () => {
                      setLink(null);
                      toast.success('Task link copied');
                    },
                    () => showLink(href),
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
      <Dialog.Root
        open={link !== null}
        onOpenChange={(open) => {
          if (!open) closeLink();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
          <Dialog.Content
            className="glass-thick fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6 outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              linkRef.current?.focus();
              linkRef.current?.select();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              actionsRef.current?.focus();
            }}
          >
            <Dialog.Title className="font-display font-semibold text-xl">Task link</Dialog.Title>
            <Dialog.Description className="mt-2 text-muted-foreground text-sm">
              Select and copy this link.
            </Dialog.Description>
            <input
              ref={linkRef}
              aria-label="Task link"
              readOnly
              value={link ?? ''}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 h-11 w-full rounded-xl bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
            />
            <Dialog.Close asChild>
              <Button className="mt-4">Done</Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
