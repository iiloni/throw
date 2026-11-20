import type { Tag } from '@throw/shared';
import { Plus } from 'lucide-react';
import { IconButton } from '@/components/IconButton/IconButton';
import { haptics } from '@/lib/haptics';
import { createStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export type NewTagRequest = {
  projectId: string;
  parentId: string | null;
  /** A top-level tag's color to start from, such as one no root holds yet. */
  color?: Tag['color'];
  /** Assigns the tag just made, as the picker that asked for it does. */
  onCreated: (id: string) => void;
  /** Called however the form closes, saved or not. */
  onClose?: () => void;
};

/** The open form's request; `NewTagHost` shows it. */
export const newTagRequest = createStore<(NewTagRequest & { id: number }) | null>(null);
/** Whether a host is mounted to show the form: without one the button would do nothing. */
export const newTagHosted = createStore(false);
let opened = 0;

/** Opens the new-tag form. The picker that asked can stay open beneath it. */
export function openNewTag(next: NewTagRequest) {
  closeNewTag();
  newTagRequest.set({ ...next, id: ++opened });
}

export function closeNewTag() {
  const open = newTagRequest.get();
  if (!open) return;
  newTagRequest.set(null);
  open.onClose?.();
}

/** Catch's "+" in a tag picker's corner, which opens the form for a new tag to assign at once. */
export function NewTagButton({ onClick, className }: { onClick: () => void; className?: string }) {
  if (!newTagHosted.use()) return null;
  return (
    <IconButton
      label="New tag"
      className={cn('size-11 shrink-0 rounded-xl text-muted-foreground [&_svg]:size-5', className)}
      onClick={() => {
        haptics.toggle();
        onClick();
      }}
    >
      <Plus />
    </IconButton>
  );
}
