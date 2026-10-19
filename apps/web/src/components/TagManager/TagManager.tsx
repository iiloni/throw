import { type Tag, tagSubtreeIds } from '@throw/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { TagEditor } from '@/components/TagForm/TagForm';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { Button } from '@/components/ui/button';
import { useTags } from '@/lib/collections';
import { useAwaitingSync } from '@/lib/syncStatus';
import { deleteTag } from '@/lib/tags';

/**
 * Project tag management, using the settings drawer on phones and a dialog on desktop.
 */
export function TagManager({ projectId }: { projectId: string }) {
  const { tags, isLoading } = useTags(projectId);
  const awaiting = useAwaitingSync(isLoading, tags.length);
  const [editing, setEditing] = useState<{ tag?: Tag; parentId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  return (
    <section aria-label="Manage project tags" className="min-w-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Project tags</h2>
        <Button
          disabled={awaiting}
          variant="secondary"
          className="h-11 rounded-xl"
          onClick={() => setEditing({ parentId: null })}
        >
          <Plus />
          New tag
        </Button>
      </div>
      {awaiting ? (
        <p role="status">Loading tags…</p>
      ) : !tags.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          Create your first tag, then add children to group related work.
        </p>
      ) : (
        <TagTree
          tags={tags}
          renderTag={(tag, path) => {
            const root = path[0] ?? tag;
            return (
              <>
                <button
                  type="button"
                  aria-label={`Edit ${path.map((item) => item.name).join(' / ')}`}
                  onClick={() => setEditing({ tag, parentId: tag.parentId })}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    data-color={root.color ?? undefined}
                    className={root.color ? 'text-tint-accent' : 'text-muted-foreground'}
                  >
                    <TagIcon name={root.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 truncate text-sm">{tag.name}</span>
                  <Pencil className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                </button>
                <IconButton
                  label={`Add child to ${tag.name}`}
                  className="size-11 shrink-0"
                  onClick={() => setEditing({ parentId: tag.id })}
                >
                  <Plus />
                </IconButton>
                <IconButton
                  label={`Delete ${tag.name}`}
                  className="size-11 shrink-0 text-destructive"
                  onClick={() => setDeleting(tag)}
                >
                  <Trash2 />
                </IconButton>
              </>
            );
          }}
        />
      )}
      {editing && (
        <ManagementSurface
          open
          title={editing.tag ? 'Edit tag' : 'New tag'}
          onClose={() => setEditing(null)}
        >
          <TagEditor
            projectId={projectId}
            tags={tags}
            initial={editing}
            onDone={() => setEditing(null)}
          />
        </ManagementSurface>
      )}
      <ManagementSurface
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'tag'}?`}
      >
        {deleting && (
          <TagDeleteConfirm tag={deleting} tags={tags} onDone={() => setDeleting(null)} />
        )}
      </ManagementSurface>
    </section>
  );
}

/** The delete confirmation's content, kept apart from its sheet like `TagEditor`. */
export function TagDeleteConfirm({
  tag,
  tags,
  onDone,
}: {
  tag: Tag;
  tags: readonly Tag[];
  onDone: () => void;
}) {
  return (
    <>
      <p className="mb-5 text-sm text-muted-foreground">
        {tagSubtreeIds(tags, tag.id).size > 1
          ? 'This tag and all its children will be removed from every task.'
          : 'This tag will be removed from every task.'}{' '}
        Tasks are kept. This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="h-11 rounded-full" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          className="h-11 rounded-full"
          onClick={() => {
            deleteTag(tag.id);
            onDone();
          }}
        >
          Delete tag
        </Button>
      </div>
    </>
  );
}
