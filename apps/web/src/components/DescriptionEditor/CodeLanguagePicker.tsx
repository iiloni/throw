import { Check, ScanText } from 'lucide-react';
import { useRef, useState } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Input } from '@/components/ui/input';
import { haptics } from '@/lib/haptics';
import { useDesktop } from '@/lib/media';
import { CODE_LANGUAGES, codeLanguageIconProps, codeLanguageId } from './codeLanguages';
import { type CodeEditor, cancelCodeDetection, detectBlockLanguage } from './codePaste';

const options = Object.entries(CODE_LANGUAGES).sort(([leftId, left], [rightId, right]) => {
  if (leftId === 'text') return -1;
  if (rightId === 'text') return 1;
  return left.name.localeCompare(right.name);
});

export function CodeLanguagePicker({
  editor,
  blockId,
  onClose,
}: {
  editor: CodeEditor;
  blockId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const desktop = useDesktop();
  const block = editor.getBlock(blockId);
  if (block?.type !== 'codeBlock') return null;
  const language = block.props.language;
  const known = codeLanguageId(language);
  const selected = known ?? (language || 'text');
  const choices =
    known || !language ? options : [...options, [language, { name: language }] as const];
  const searchTerm = query.trim().toLowerCase();
  const filtered = choices.filter(([id, option]) => {
    const names = [id, option.name, ...('aliases' in option ? option.aliases : [])];
    return names.some((name) => name.toLowerCase().includes(searchTerm));
  });

  function choose(value?: string) {
    if (!editor.isEditable || editor.getBlock(blockId)?.type !== 'codeBlock') return;
    haptics.selection();
    if (value === undefined) void detectBlockLanguage(editor, blockId, true);
    else {
      cancelCodeDetection(editor, blockId);
      editor.updateBlock(blockId, { props: { language: value } });
    }
    onClose();
  }

  return (
    <ManagementSurface
      open
      title="Code language"
      onClose={onClose}
      initialFocusRef={desktop ? search : undefined}
    >
      <div className="sticky top-0 z-10 bg-popover/95 pt-1 pb-2">
        <Input
          ref={search}
          type="search"
          aria-label="Search languages"
          placeholder="Search languages…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <button type="button" className={optionClass} onClick={() => choose()}>
        <ScanText className="size-4" aria-hidden />
        Detect language
      </button>
      {filtered.map(([id, option]) => (
        <button
          key={id}
          type="button"
          className={optionClass}
          aria-pressed={selected === id}
          onClick={() => choose(id)}
        >
          <span className="description-code-icon" aria-hidden {...codeLanguageIconProps(id)} />
          {option.name}
          {selected === id && <Check className="ml-auto size-4 text-ring" aria-hidden />}
        </button>
      ))}
      {filtered.length === 0 && (
        <p className="px-3 py-2 text-muted-foreground">No language matches.</p>
      )}
    </ManagementSurface>
  );
}

const optionClass =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent';
