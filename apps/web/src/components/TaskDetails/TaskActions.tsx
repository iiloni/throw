import { isClosedCategory, type Status, type Task } from '@throw/shared';
import { Check, Copy, Link2, RotateCcw } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBackHandler } from '@/lib/backButton';
import { feelStatusChange } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { sendTask } from '@/lib/tasks';

// The rows of the dock's other panels, as Catch's move picker draws them.
const action =
  'h-12 justify-start gap-2.5 rounded-[calc(var(--dock-radius)-0.25rem)] bg-foreground/[0.04] px-4 text-foreground/80 hover:bg-foreground/[0.07] hover:text-foreground [&_svg]:size-4';

/**
 * Link another task, close or reopen the task, and copy its link. Content only: whatever hosts
 * it closes it from `onDone` and returns focus to what opened it.
 */
export function TaskActions({
  task,
  statuses,
  onDone,
  onLink,
}: {
  task: Task;
  statuses: Status[];
  onDone(): void;
  onLink?: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useBackHandler(link !== null, () => setLink(null));
  const status = statuses.find((row) => row.id === task.statusId);
  const closed = status && isClosedCategory(status.category);
  const target = statuses.find(
    (row) => row.category === (closed ? 'backlog' : 'done') && row.isDefault,
  );
  return (
    <>
      <div className="flex flex-col gap-1.5 px-2 pt-2 pb-1">
        {onLink && (
          <Button variant="ghost" className={action} onClick={onLink}>
            <Link2 />
            Link a task
          </Button>
        )}
        {target && (
          <Button
            variant="ghost"
            className={action}
            onClick={() => {
              sendTask(task.id, target.id);
              feelStatusChange(target.category);
              onDone();
            }}
          >
            {closed ? <RotateCcw /> : <Check />}
            {closed ? 'Reopen task' : 'Close task'}
          </Button>
        )}
        <Button
          variant="ghost"
          className={action}
          onClick={() => {
            const href = new URL(
              `/w/${task.workspaceId}/p/${task.projectId}?view=board&task=${task.id}`,
              getServerUrl(),
            ).href;
            if (!navigator.clipboard) setLink(href);
            else
              void navigator.clipboard.writeText(href).then(
                () => {
                  toast.success('Task link copied');
                  onDone();
                },
                () => setLink(href),
              );
          }}
        >
          <Copy />
          Copy task link
        </Button>
      </div>
      <Dialog.Root
        open={link !== null}
        onOpenChange={(open) => {
          if (!open) setLink(null);
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
            // Once the dialog has let go of focus, the host can return it to its opener.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              onDone();
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
