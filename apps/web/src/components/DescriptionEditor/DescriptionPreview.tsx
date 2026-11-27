import type { Description } from '@throw/shared';
import { Copy, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTaskReferences } from '@/components/TaskReferences/TaskReferences';
import { splitTaskReferences } from '@/lib/taskReferences';
import { cn } from '@/lib/utils';
import { codeLanguageIconProps, codeLanguageName } from './codeLanguages';

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => value !== null && typeof value === 'object';

/** The category of the task a reference names, or undefined where it names none. */
type Resolve = (identifier: string) => string | undefined;

/** Plain text with its task references drawn as the editor draws them (taskReferencePlugin). */
function referenced(text: string, resolve: Resolve | null): ReactNode {
  if (!resolve) return text;
  const segments = splitTaskReferences(text, (identifier) => resolve(identifier) !== undefined);
  if (segments.length === 1 && segments[0]!.kind === 'text') return text;
  return segments.map((segment, index) =>
    segment.kind === 'text' ? (
      segment.text
    ) : (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: the segments of one fixed string
        key={index}
        className="task-ref"
        data-task-ref={segment.identifier}
        data-category={resolve(segment.identifier)}
      >
        {segment.text}
      </span>
    ),
  );
}

// Catch's NotePreview, narrowed to description text. Links stay inert during the morph, and
// so do task references.
function inline(content: unknown, resolve: Resolve | null, key = 0): ReactNode {
  if (typeof content === 'string') return referenced(content, resolve);
  if (Array.isArray(content)) return content.map((item, index) => inline(item, resolve, index));
  if (!object(content)) return null;
  if (content.type === 'link')
    return (
      <span key={key} className="underline">
        {inline(content.content, null)}
      </span>
    );
  if (typeof content.text !== 'string') return null;
  const styles = object(content.styles) ? content.styles : {};
  return (
    <span
      key={key}
      className={cn(
        Boolean(styles.bold) && 'font-bold',
        Boolean(styles.italic) && 'italic',
        Boolean(styles.underline) && 'underline',
        Boolean(styles.strike) && 'line-through',
        Boolean(styles.code) &&
          'rounded-[0.375em] bg-foreground/10 px-[0.4em] pt-[0.12em] pb-[0.05em] font-mono text-[0.9em]',
      )}
    >
      {styles.code ? content.text : referenced(content.text, resolve)}
    </span>
  );
}

function block(row: Json, index: number, resolve: Resolve | null): ReactNode {
  const props = object(row.props) ? row.props : {};
  // Code is about its characters: a reference written in it stays text, as in the editor.
  const text = inline(row.content, row.type === 'codeBlock' ? null : resolve) ?? <br />;
  let body: ReactNode;
  switch (row.type) {
    case 'heading':
      body = (
        <h3
          className="pt-[18px]! font-bold font-display"
          style={{
            fontSize:
              ({ 1: '3em', 2: '2em', 3: '1.3em' } as Record<number, string>)[Number(props.level)] ??
              '1.3em',
          }}
        >
          {text}
        </h3>
      );
      break;
    case 'checkListItem':
      body = (
        <p className="flex gap-2">
          <span aria-hidden>{props.checked ? '☑' : '☐'}</span>
          <span className={cn(Boolean(props.checked) && 'line-through')}>{text}</span>
        </p>
      );
      break;
    case 'bulletListItem':
      body = (
        <p className="flex gap-2">
          <span aria-hidden>•</span>
          <span>{text}</span>
        </p>
      );
      break;
    case 'numberedListItem':
      body = (
        <p className="flex gap-2">
          <span aria-hidden>{index + 1}.</span>
          <span>{text}</span>
        </p>
      );
      break;
    case 'quote':
      body = <blockquote className="border-current/30 border-l-2 pl-3 italic">{text}</blockquote>;
      break;
    case 'codeBlock':
      body = (
        <div className="description-code-block">
          <div className="description-code-toolbar glass">
            <div className="description-code-language">
              <span>
                <span
                  aria-hidden
                  className="code-language-icon"
                  {...codeLanguageIconProps(props.language)}
                />
                <span className="description-code-label truncate">
                  {codeLanguageName(props.language)}
                </span>
              </span>
            </div>
            <span aria-hidden className="description-code-action">
              <Copy />
            </span>
            <span aria-hidden className="description-code-action">
              <Download />
            </span>
          </div>
          <pre>
            <code>{text}</code>
          </pre>
        </div>
      );
      break;
    case 'divider':
      body = <hr className="my-3" />;
      break;
    case 'table': {
      const content = object(row.content) ? row.content : {};
      const rows = Array.isArray(content.rows) ? content.rows : [];
      body = (
        <div>
          {rows.filter(object).map((row, index) => (
            <p key={String(row.id ?? index)} className="flex gap-4 border-border border-b py-1">
              {Array.isArray(row.cells)
                ? row.cells.map((cell, index) => (
                    <span key={String(index)}>
                      {inline(object(cell) && 'content' in cell ? cell.content : cell, resolve)}
                    </span>
                  ))
                : null}
            </p>
          ))}
        </div>
      );
      break;
    }
    case 'paragraph':
      body = <p>{text}</p>;
      break;
    default:
      return null;
  }
  return (
    <div key={String(row.id ?? index)} className="description-preview-block">
      {body}
      {Array.isArray(row.children) && (
        <div className="pl-5">
          {row.children.filter(object).map((child, index) => block(child, index, resolve))}
        </div>
      )}
    </div>
  );
}

/** Match the editor's first painted text while its heavy module waits for the morph. */
export function DescriptionPreview({ document }: { document: Description }) {
  const references = useTaskReferences();
  const resolve: Resolve | null =
    references &&
    ((identifier) => {
      const found = references.index.resolve(references.workspaceId, identifier);
      return found && (found.status?.category ?? 'backlog');
    });
  return (
    <div className="min-h-12 whitespace-pre-wrap text-[0.9375rem] leading-[1.65]">
      {document?.slice(0, 200).map((row, index) => block(row, index, resolve))}
    </div>
  );
}
