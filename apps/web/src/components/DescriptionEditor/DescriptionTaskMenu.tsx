import { SuggestionMenu } from '@blocknote/core/extensions';
import {
  SuggestionMenuController,
  type SuggestionMenuProps,
  useBlockNoteEditor,
} from '@blocknote/react';
import type { Transaction } from 'prosemirror-state';
import { useCallback, useEffect, useRef } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import type { ReferencedTask } from '@/components/TaskReferences/referenceIndex';
import type { TaskReferences } from '@/components/TaskReferences/TaskReferences';
import { canStartTaskReference, taskReferenceText } from '@/lib/taskReferences';
import { cn } from '@/lib/utils';
import { suggestionMenuFloatingOptions } from './DescriptionSlashMenu';

type TaskItem = { reference: ReferencedTask; crossProject: boolean };

// `#` starts a reference only where one could stand: not inside a word (`C#`), a URL or code.
function shouldOpen(tr: Transaction) {
  const { $from } = tr.selection;
  if ($from.marks().some((mark) => mark.type.spec.code || mark.type.name === 'link')) return false;
  return canStartTaskReference($from.parent.textBetween(0, $from.parentOffset, undefined, '￼'));
}

/**
 * Typing `#` offers the workspace's tasks, the current project's first, and picking one writes
 * its `#KEY-N` as plain text. A query nothing matches closes the menu, so Enter is never kept
 * from the text.
 */
export function DescriptionTaskMenu({ references }: { references: TaskReferences }) {
  const editor = useBlockNoteEditor();
  const getItems = useCallback(
    async (query: string): Promise<TaskItem[]> => {
      // A space straight after `#` is a heading's shortcut, and text after a whole
      // identifier is the sentence going on: Enter there is a new line, not a pick.
      if (/^\s/.test(query) || /^[a-z][a-z0-9]{0,5}-\d+[^\da-z]/i.test(query)) return [];
      return references.index
        .suggest(references.workspaceId, query, {
          currentProjectId: references.projectId,
          excludeTaskId: references.taskId,
        })
        .map((reference) => ({
          reference,
          crossProject: reference.project.id !== references.projectId,
        }));
    },
    [references],
  );
  const insert = useCallback(
    (item: TaskItem) => {
      editor.insertInlineContent(`${taskReferenceText(item.reference.identifier)} `);
    },
    [editor],
  );
  return (
    <SuggestionMenuController
      triggerCharacter="#"
      shouldOpen={shouldOpen}
      getItems={getItems}
      onItemClick={insert}
      suggestionMenuComponent={TaskSuggestionMenu}
      floatingUIOptions={suggestionMenuFloatingOptions}
    />
  );
}

function TaskSuggestionMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<TaskItem>) {
  const editor = useBlockNoteEditor();
  const empty = loadingState === 'loaded' && items.length === 0;
  useEffect(() => {
    if (empty) editor.getExtension(SuggestionMenu)?.closeMenu();
  }, [editor, empty]);
  if (items.length === 0) return null;
  return (
    <div
      id="bn-suggestion-menu"
      role="listbox"
      aria-label="Tasks"
      // BlockNote's own menu surface (the slash menu's), sized for a task's title.
      className="bn-suggestion-menu z-50 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      {items.map((item, index) => (
        <TaskSuggestion
          key={item.reference.task.id}
          item={item}
          index={index}
          selected={index === selectedIndex}
          onPick={() => onItemClick?.(item)}
        />
      ))}
    </div>
  );
}

function TaskSuggestion({
  item,
  index,
  selected,
  onPick,
}: {
  item: TaskItem;
  index: number;
  selected: boolean;
  onPick(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const { reference, crossProject } = item;
  return (
    // The editor keeps focus and drives the list from its keys, as BlockNote's items do.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the editor's keys pick it (aria-activedescendant)
    <div
      ref={ref}
      id={`bn-suggestion-menu-item-${index}`}
      role="option"
      tabIndex={-1}
      aria-selected={selected || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className="flex min-h-9 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent aria-selected:bg-accent pointer-coarse:min-h-11"
    >
      <StatusGlyph
        category={reference.status?.category ?? 'backlog'}
        color={reference.status?.color}
        className="text-muted-foreground"
      />
      <span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
        {reference.identifier}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          reference.closed && 'text-muted-foreground line-through decoration-foreground/30',
        )}
      >
        {reference.task.title || 'Untitled task'}
      </span>
      {crossProject && (
        <span
          data-color={reference.project.color}
          className="max-w-[40%] shrink-0 truncate rounded-md bg-tint px-1.5 font-medium text-[0.6875rem] text-foreground/80"
        >
          {reference.project.name}
        </span>
      )}
    </div>
  );
}
