import type { Description } from '@throw/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => value !== null && typeof value === 'object';

// Catch's NotePreview, narrowed to description text. Links stay inert during the morph.
function inline(content: unknown, key = 0): ReactNode {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item, index) => inline(item, index));
  if (!object(content)) return null;
  if (content.type === 'link')
    return (
      <span key={key} className="underline">
        {inline(content.content)}
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
        Boolean(styles.code) && 'rounded bg-foreground/10 px-1 font-mono',
      )}
    >
      {content.text}
    </span>
  );
}

function block(row: Json, index: number): ReactNode {
  const props = object(row.props) ? row.props : {};
  const text = inline(row.content) ?? <br />;
  let body: ReactNode;
  switch (row.type) {
    case 'heading':
      body = (
        <h3
          className="pt-4 font-bold font-display"
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
        <pre className="whitespace-pre-wrap rounded-xl bg-foreground/[0.06] p-3 font-mono">
          {text}
        </pre>
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
                      {inline(object(cell) && 'content' in cell ? cell.content : cell)}
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
    <div key={String(row.id ?? index)} className="py-[3px]">
      {body}
      {Array.isArray(row.children) && (
        <div className="pl-5">{row.children.filter(object).map(block)}</div>
      )}
    </div>
  );
}

/** Match the editor's first painted text while its heavy module waits for the morph. */
export function DescriptionPreview({ document }: { document: Description }) {
  return (
    <div className="min-h-12 whitespace-pre-wrap text-[0.9375rem] leading-[1.65]">
      {document?.slice(0, 200).map(block)}
    </div>
  );
}
