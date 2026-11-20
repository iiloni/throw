import { type RefObject, useEffect, useRef } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { TagEditor } from '@/components/TagForm/TagForm';
import { useTags } from '@/lib/collections';
import { closeNewTag, type NewTagRequest, newTagHosted, newTagRequest } from './NewTag';

/**
 * The form a picker's "New tag" opens. It lives with the shell rather than in the picker: on a
 * phone it is a page of the drawer in place of the picker's (ADR 0009), which unmounts the
 * picker until Back returns to it; on desktop it is the centred dialog over the open panel.
 */
export function NewTagHost() {
  const open = newTagRequest.use();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    newTagHosted.set(true);
    return () => newTagHosted.set(false);
  }, []);
  return (
    <ManagementSurface
      open={open !== null}
      title="New tag"
      onClose={closeNewTag}
      initialFocusRef={nameRef}
    >
      {open && <NewTagForm key={open.id} open={open} nameRef={nameRef} />}
    </ManagementSurface>
  );
}

function NewTagForm({
  open,
  nameRef,
}: {
  open: NewTagRequest;
  nameRef: RefObject<HTMLInputElement | null>;
}) {
  const { tags } = useTags(open.projectId);
  return (
    <TagEditor
      projectId={open.projectId}
      tags={tags}
      initial={{ parentId: open.parentId, color: open.color ?? null }}
      onCreated={open.onCreated}
      onDone={closeNewTag}
      nameRef={nameRef}
    />
  );
}
