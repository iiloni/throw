import {
  type Color,
  STATUS_CATEGORIES,
  type Status,
  type StatusCategory,
  type Task,
} from '@throw/shared';
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Ellipsis,
  GripVertical,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, type DragControls, motion, Reorder, useDragControls } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { type KeyboardEvent, type RefObject, useMemo, useRef, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { CATEGORY_NAMES } from '@/components/Board/StatusMenu';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { Hint } from '@/components/Hint/Hint';
import { IconButton } from '@/components/IconButton/IconButton';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStatusColorSupport } from '@/lib/compatibility';
import { useEntryMotion } from '@/lib/entryMotion';
import { haptics } from '@/lib/haptics';
import { curves } from '@/lib/motion';
import { statusDeletionIssue, statusUsage } from '@/lib/projectSettings';
import {
  createStatus,
  deleteStatus,
  makeDefaultStatus,
  moveStatus,
  renameStatus,
  setStatusColor,
} from '@/lib/statuses';
import { cn } from '@/lib/utils';

type Actions = {
  rename: (status: Status) => void;
  recolor?: (status: Status) => void;
  remove: (status: Status) => void;
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
  const colorSupported = useStatusColorSupport();
  const [colorEditor, setColorEditor] = useState<Status | null>(null);
  const [color, setColor] = useState<Color | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const counts = useMemo(() => statusUsage(tasks), [tasks]);
  const removed = statuses.find((status) => status.id === deleting);
  const removalIssue =
    removed && statusDeletionIssue(removed, statuses, counts.get(removed.id) ?? 0);
  const actions: Actions = {
    rename: (status) => setEditor({ category: status.category, status }),
    recolor: colorSupported
      ? (status) => {
          setColor(status.color ?? null);
          setColorEditor(status);
        }
      : undefined,
    remove: (status) => setDeleting(status.id),
  };
  return (
    <section aria-label="Statuses" className="flex flex-col gap-6">
      <p className="px-1 text-muted-foreground text-sm">
        A status keeps the category it’s made in. Task counts include the trash.
      </p>
      {STATUS_CATEGORIES.map((category) => (
        <CategoryGroup
          key={category}
          category={category}
          statuses={statuses.filter((status) => status.category === category)}
          counts={counts}
          actions={actions}
          onAdd={() => setEditor({ category })}
        />
      ))}
      {error && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
      {editor && (
        <ManagementSurface
          open
          title={editor.status ? 'Rename status' : `Add ${CATEGORY_NAMES[editor.category]} status`}
          onClose={() => setEditor(null)}
        >
          <StatusForm
            key={editor.status?.id ?? editor.category}
            initial={editor.status?.name ?? ''}
            pickColor={colorSupported && !editor.status}
            onCancel={() => setEditor(null)}
            onSave={(name, color) => {
              if (editor.status) renameStatus(editor.status.id, name);
              else createStatus(projectId, name, editor.category, color);
              haptics.success();
              setEditor(null);
            }}
          />
        </ManagementSurface>
      )}
      {colorEditor && (
        <ManagementSurface open title="Change status color" onClose={() => setColorEditor(null)}>
          <ColorPicker allowNone value={color} onChange={setColor} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setColorEditor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setStatusColor(colorEditor.id, color);
                haptics.success();
                setColorEditor(null);
              }}
            >
              Save color
            </Button>
          </div>
        </ManagementSurface>
      )}
      {/* A status that cannot go says why here, when someone asks to delete it. */}
      <ManagementSurface
        open={!!removed}
        fit
        title={removalIssue ? `Can’t delete ${removed?.name ?? 'status'}` : 'Delete status?'}
        onClose={() => setDeleting(null)}
      >
        <p className="mb-5 break-words text-muted-foreground text-sm">
          {removalIssue ??
            `“${removed?.name ?? ''}” will be removed. Tasks and their history are kept.`}
        </p>
        <div className="flex justify-end gap-2">
          {removalIssue ? (
            <Button autoFocus variant="secondary" onClick={() => setDeleting(null)}>
              OK
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (removed) {
                    const failure = deleteStatus(removed.id);
                    if (!failure) haptics.warning();
                    setError(failure ?? '');
                  }
                  setDeleting(null);
                }}
              >
                Delete status
              </Button>
            </>
          )}
        </div>
      </ManagementSurface>
    </section>
  );
}

/**
 * One category's statuses on a settings card, headed by the glyph the board draws for it.
 * Rows are put in order by dragging their handle, with the arrow keys on it, or from their
 * menu.
 */
function CategoryGroup({
  category,
  statuses,
  counts,
  actions,
  onAdd,
}: {
  category: StatusCategory;
  statuses: Status[];
  counts: ReadonlyMap<string, number>;
  actions: Actions;
  onAdd: () => void;
}) {
  const name = CATEGORY_NAMES[category];
  const key = statuses.map((status) => status.id).join();
  // The order a drag left, held until the write reaches the collection so a dropped row
  // does not jump back for a frame. `basis` is the collection's order it was made from.
  const [held, setHeld] = useState<{ order: Status[]; basis: string } | null>(null);
  const latest = useRef<Status[]>(statuses);
  // A refused move puts the collection back to the order the drag began from: show that.
  if (held && held.basis !== key) setHeld(null);
  const rows = held && held.basis === key ? held.order : statuses;
  latest.current = rows;
  // Rows there when the page opened arrive with their card; later ones enter on their own.
  const initial = useRef(new Set(statuses.map((status) => status.id)));
  const movable = statuses.length > 1;
  const list = useRef<HTMLUListElement>(null);

  const settle = (status: Status, order: readonly Status[]) => {
    const index = order.findIndex((row) => row.id === status.id);
    const before = order[index - 1] ?? null;
    const after = order[index + 1] ?? null;
    const was = statuses.findIndex((row) => row.id === status.id);
    if (index === was) {
      setHeld(null);
      return;
    }
    setHeld({ order: [...order], basis: key });
    moveStatus(status.id, before, after);
  };
  const step = (status: Status, by: 1 | -1) => {
    const from = rows.findIndex((row) => row.id === status.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= rows.length) return;
    const next = [...rows];
    next.splice(from, 1);
    next.splice(to, 0, status);
    haptics.selection();
    settle(status, next);
  };

  return (
    <SettingsSection
      title={name}
      icon={<StatusGlyph category={category} />}
      action={
        <IconButton
          label={`Add status to ${name}`}
          className="-my-2.5 -mr-3 size-11 text-muted-foreground hover:text-foreground"
          onClick={onAdd}
        >
          <Plus />
        </IconButton>
      }
    >
      <Reorder.Group
        ref={list}
        as="ul"
        axis="y"
        values={rows}
        onReorder={(next: Status[]) => {
          if (next.some((status, index) => status.id !== rows[index]?.id)) haptics.selection();
          setHeld({ order: next, basis: key });
        }}
        className="flex flex-col divide-y divide-foreground/[0.06]"
      >
        <AnimatePresence initial={false}>
          {rows.map((status, index) => (
            <StatusRow
              key={status.id}
              status={status}
              count={counts.get(status.id) ?? 0}
              first={index === 0}
              last={index === rows.length - 1}
              movable={movable}
              entered={initial.current.has(status.id)}
              list={list}
              actions={actions}
              onStep={(by) => step(status, by)}
              onDrop={() => settle(status, latest.current)}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </SettingsSection>
  );
}

function StatusRow({
  status,
  count,
  first,
  last,
  movable,
  entered,
  list,
  actions,
  onStep,
  onDrop,
}: {
  status: Status;
  count: number;
  first: boolean;
  last: boolean;
  movable: boolean;
  entered: boolean;
  /** The category's list, which a dragged row stays within. */
  list: RefObject<HTMLUListElement | null>;
  actions: Actions;
  onStep: (by: 1 | -1) => void;
  onDrop: () => void;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const entry = useEntryMotion(`status:${status.id}`, true, 0, entered);
  return (
    <Reorder.Item
      as="li"
      value={status}
      aria-label={status.name}
      dragListener={false}
      dragControls={controls}
      dragConstraints={list}
      dragElastic={0.1}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        onDrop();
      }}
      exit={{ opacity: 0, height: 0, transition: curves.fade }}
      className={cn(
        'relative overflow-hidden first:rounded-t-2xl last:rounded-b-2xl',
        dragging && 'z-10 rounded-2xl bg-popover shadow-lg',
      )}
    >
      <motion.div style={entry} className="flex min-h-14 items-center gap-1 py-1.5 pr-1 pl-4">
        {status.color && (
          <span data-column-color={status.color} className="text-[color:var(--column-accent)]">
            <StatusGlyph category={status.category} />
          </span>
        )}
        <span className="min-w-0 flex-1 break-words font-medium">
          {status.name}
          {status.isDefault && (
            <span className="ml-2 inline-block translate-y-[-1px] rounded-full bg-foreground/[0.08] px-2 py-0.5 align-middle font-semibold text-[0.6875rem] text-muted-foreground">
              Default
            </span>
          )}
        </span>
        <span className="shrink-0 pl-1 text-muted-foreground text-sm tabular-nums">
          {count} {count === 1 ? 'task' : 'tasks'}
        </span>
        <StatusMenu status={status} first={first} last={last} actions={actions} onStep={onStep} />
        {movable ? (
          <MoveHandle status={status} controls={controls} onStep={onStep} />
        ) : (
          // Keeps counts and menus in line with the categories that can be reordered.
          <span aria-hidden className="w-11 shrink-0" />
        )}
      </motion.div>
    </Reorder.Item>
  );
}

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

/** A row's secondary actions, so the row itself shows only what the status is. */
function StatusMenu({
  status,
  first,
  last,
  actions,
  onStep,
}: {
  status: Status;
  first: boolean;
  last: boolean;
  actions: Actions;
  onStep: (by: 1 | -1) => void;
}) {
  // An action that opens a form waits for the menu to give focus back to its button, so the
  // form returns focus there when it closes.
  const pending = useRef<(() => void) | null>(null);
  const after = (action: () => void) => () => {
    pending.current = action;
  };
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={`Manage ${status.name}`} className="size-11 shrink-0">
          <Ellipsis />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="shell-menu glass-thick z-50 w-52 rounded-3xl p-2"
          onCloseAutoFocus={() => {
            const action = pending.current;
            pending.current = null;
            if (action) setTimeout(action);
          }}
        >
          <DropdownMenu.Item className={itemClass} onSelect={after(() => actions.rename(status))}>
            <Pencil aria-hidden />
            Rename
          </DropdownMenu.Item>
          {actions.recolor && (
            <DropdownMenu.Item
              className={itemClass}
              onSelect={after(() => actions.recolor?.(status))}
            >
              <Palette aria-hidden />
              Change color
            </DropdownMenu.Item>
          )}
          {!status.isDefault && (
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => {
                makeDefaultStatus(status.id);
                haptics.toggle();
              }}
            >
              <CircleCheck aria-hidden />
              Make default
            </DropdownMenu.Item>
          )}
          {!first && (
            <DropdownMenu.Item className={itemClass} onSelect={() => onStep(-1)}>
              <ArrowUp aria-hidden />
              Move up
            </DropdownMenu.Item>
          )}
          {!last && (
            <DropdownMenu.Item className={itemClass} onSelect={() => onStep(1)}>
              <ArrowDown aria-hidden />
              Move down
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="mx-3 my-1 h-px bg-foreground/[0.08]" />
          <DropdownMenu.Item
            className={cn(itemClass, 'text-destructive [&_svg]:text-destructive')}
            onSelect={after(() => actions.remove(status))}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Only the handle starts a drag, so the rest of the row scrolls the page on a touch screen.
 * Focused, the arrow keys move the status instead.
 */
function MoveHandle({
  status,
  controls,
  onStep,
}: {
  status: Status;
  controls: DragControls;
  onStep: (by: 1 | -1) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const by = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!by) return;
    event.preventDefault();
    onStep(by);
  };
  return (
    <Hint label="Drag, or use the arrow keys, to reorder" describe>
      <button
        type="button"
        aria-label={`Reorder ${status.name}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          haptics.longPress();
          controls.start(event);
        }}
        onKeyDown={onKeyDown}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
    </Hint>
  );
}

function StatusForm({
  initial,
  pickColor,
  onSave,
  onCancel,
}: {
  initial: string;
  pickColor: boolean;
  onSave: (name: string, color?: Color) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [color, setColor] = useState<Color | null>(null);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim(), pickColor ? (color ?? undefined) : undefined);
      }}
    >
      <label htmlFor="status-name" className="flex flex-col gap-2 font-medium text-sm">
        Status name
        <Input
          id="status-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          required
        />
      </label>
      {pickColor && <ColorPicker allowNone value={color} onChange={setColor} />}
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
