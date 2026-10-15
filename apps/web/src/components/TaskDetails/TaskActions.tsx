import { isClosedCategory, type Status, type Task } from '@throw/shared';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type RefObject, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBackHandler } from '@/lib/backButton';
import { getServerUrl } from '@/lib/serverUrl';
import { sendTask } from '@/lib/tasks';

export function TaskActions({
  task,
  statuses,
  returnFocus,
}: {
  task: Task;
  statuses: Status[];
  returnFocus: RefObject<HTMLElement | null>;
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
      <div className="flex flex-col gap-1 p-3">
        {target && (
          <Button
            variant="ghost"
            className="min-h-12 justify-start gap-3 rounded-xl"
            onClick={() => sendTask(task.id, target.id)}
          >
            {closed ? <RotateCcw /> : <Check />}
            {closed ? 'Reopen task' : 'Close task'}
          </Button>
        )}
        <Button
          variant="ghost"
          className="min-h-12 justify-start gap-3 rounded-xl"
          onClick={() => {
            const href = new URL(
              `/w/${task.workspaceId}/p/${task.projectId}?view=board&task=${task.id}`,
              getServerUrl(),
            ).href;
            if (!navigator.clipboard) setLink(href);
            else
              void navigator.clipboard.writeText(href).then(
                () => toast.success('Task link copied'),
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
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
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
