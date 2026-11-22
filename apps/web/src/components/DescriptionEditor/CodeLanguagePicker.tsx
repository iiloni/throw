import { Check, ScanText, Search } from 'lucide-react';
import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useBackHandler } from '@/lib/backButton';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CODE_LANGUAGES, codeLanguageIconProps, codeLanguageId } from './codeLanguages';
import { type CodeEditor, cancelCodeDetection, detectBlockLanguage } from './codePaste';

type LanguageOption = {
  value: string;
  label: string;
  keywords?: readonly string[];
  icon?: ReactNode;
};

const CODE_LANGUAGE_OPTIONS: LanguageOption[] = Object.entries(CODE_LANGUAGES).map(
  ([value, language]) => ({
    value,
    label: language.name,
    keywords: [value, ...('aliases' in language ? language.aliases : [])],
    icon: <span aria-hidden className="code-language-icon" {...codeLanguageIconProps(value)} />,
  }),
);

const plain = (text: string) => text.trim().toLowerCase();

function rank(option: LanguageOption, wanted: string) {
  const label = plain(option.label);
  const words = [label, ...(option.keywords ?? []).map(plain)];
  if (words.includes(wanted)) return 0;
  if (label.startsWith(wanted)) return 1;
  if (words.some((word) => word.startsWith(wanted))) return 2;
  return words.some((word) => word.includes(wanted)) ? 3 : null;
}

function searchOptions(options: readonly LanguageOption[], query: string) {
  const wanted = plain(query);
  if (!wanted) return [...options];
  return options
    .flatMap((option) => {
      const score = rank(option, wanted);
      return score === null ? [] : [{ option, score }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ option }) => option);
}

const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

function keyboardInset() {
  if (typeof document === 'undefined') return 0;
  return (
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard')) ||
    0
  );
}

/** Catch's SearchSelectPopover for choosing a code block's language beside its pill. */
export function CodeLanguagePicker({
  editor,
  blockId,
  anchor,
  onClose,
}: {
  editor: CodeEditor;
  blockId: string;
  anchor: Element;
  onClose: () => void;
}) {
  useBackHandler(true, onClose);
  const block = editor.getBlock(blockId);
  const language = block?.type === 'codeBlock' ? String(block.props.language ?? '') : '';
  const known = codeLanguageId(language);
  const value = known ?? (language || 'text');
  const options = useMemo<LanguageOption[]>(
    () => [
      {
        value: '__detect',
        label: 'Detect language',
        icon: <ScanText className="size-4 shrink-0" aria-hidden />,
      },
      ...(known || !language
        ? CODE_LANGUAGE_OPTIONS
        : [...CODE_LANGUAGE_OPTIONS, { value: language, label: language }]),
    ],
    [known, language],
  );
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const chosen = useRef(false);

  if (block?.type !== 'codeBlock') return null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        data-search-select
        aria-label="Code language"
        align="end"
        sideOffset={6}
        collisionPadding={{ top: 12, right: 12, left: 12, bottom: keyboardInset() + 12 }}
        className="z-[90] flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-3xl p-2"
        onOpenAutoFocus={(event) => {
          if (!coarsePointer()) return;
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
        // Back to the code, as the list took focus from it. Its button was drawn again for
        // the new language, so the popover has nothing to return focus to.
        onCloseAutoFocus={(event) => {
          if (!chosen.current) return;
          event.preventDefault();
          if (editor.getBlock(blockId)) editor.setTextCursorPosition(blockId, 'end');
          editor.focus();
        }}
        // The anchor toggles the list itself; dismissing on its press would reopen it.
        onPointerDownOutside={(event) => {
          if (event.target instanceof Node && anchor.contains(event.target)) event.preventDefault();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <LanguageList
          options={options}
          value={value}
          onChange={(selected) => {
            if (!editor.isEditable || !editor.getBlock(blockId)) return;
            chosen.current = true;
            cancelCodeDetection(editor, blockId);
            if (selected === '__detect') {
              void detectBlockLanguage(editor, blockId, true);
            } else {
              editor.updateBlock(blockId, { props: { language: selected } });
            }
            onClose();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function LanguageList({
  options,
  value,
  onChange,
}: {
  options: readonly LanguageOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => searchOptions(options, query), [options, query]);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const activeOption = shown[Math.min(active, shown.length - 1)];

  useLayoutEffect(() => {
    const box = list.current;
    const selected = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && selected) {
      box.scrollTop =
        selected.offsetTop - box.offsetTop - (box.clientHeight - selected.offsetHeight) / 2;
    }
  }, []);

  function move(to: number) {
    if (!shown.length) return;
    const next = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(next);
    const box = list.current;
    const row = box?.querySelectorAll('[role="option"]')[next];
    if (!box || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
    }
  }

  const choose = (option: LanguageOption) => {
    haptics.selection();
    onChange(option.value);
  };

  return (
    <>
      <label className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 focus-within:ring-2 focus-within:ring-ring/70 focus-within:ring-inset">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-label="Search languages"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={activeOption ? `${id}-${activeOption.value}` : undefined}
          aria-autocomplete="list"
          placeholder="Search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            if (list.current) list.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(active + 1);
            else if (event.key === 'ArrowUp') move(active - 1);
            else if (event.key === 'Home') move(0);
            else if (event.key === 'End') move(shown.length - 1);
            else if (event.key === 'Enter') {
              if (activeOption) choose(activeOption);
            } else return;
            event.preventDefault();
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <div ref={list} className="h-72 min-h-24 shrink overflow-y-auto overscroll-contain">
        <div id={`${id}-list`} role="listbox" aria-label="Code language">
          {shown.map((option) => {
            const selected = option.value === value;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search field holds focus and takes the keys for the list
              <div
                key={option.value}
                id={`${id}-${option.value}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                data-active={option === activeOption || undefined}
                onClick={() => choose(option)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm outline-none transition-colors duration-200',
                  selected
                    ? 'glass-chosen'
                    : 'hover:bg-foreground/[0.06] data-active:bg-foreground/[0.06]',
                )}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p role="status" className="px-3 py-6 text-center text-muted-foreground text-sm">
            No language matches.
          </p>
        )}
      </div>
    </>
  );
}
