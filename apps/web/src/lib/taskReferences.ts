/**
 * Inline task references: `#THR-93` written in a description or a comment. A reference is
 * plain text in the stored document and in Markdown, so MCP, offline writes and older clients
 * read and write it unchanged; only the app draws it as a link, and only while the device
 * holds a task by that identifier in the same workspace.
 */

/** One `#KEY-N` in a run of text, by its offsets in that text. */
export type TaskReferenceMatch = {
  /** Offset of the `#`. */
  start: number;
  /** Offset just past the number. */
  end: number;
  /** The identifier as the app shows it, with the key upper-cased: `THR-93`. */
  identifier: string;
};

// A key as ADR 0007 settles it (`[A-Z][A-Z0-9]{0,5}`), in either case, and a number without
// leading zeros. A letter, digit, `#`, `/` or `&` before the hash makes it part of something
// else: a word (`C#`), a URL's fragment or an HTML entity. A letter or digit straight after
// the number makes it another word.
const REFERENCE =
  /(?<![\p{L}\p{N}_#/&])#([A-Za-z][A-Za-z0-9]{0,5})-([1-9]\d{0,8})(?![\p{L}\p{N}_])/gu;

/** Every reference-shaped `#KEY-N` in `text`, whether or not a task answers to it. */
export function findTaskReferences(text: string): TaskReferenceMatch[] {
  const matches: TaskReferenceMatch[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const start = match.index;
    matches.push({
      start,
      end: start + match[0].length,
      identifier: `${match[1]!.toUpperCase()}-${match[2]}`,
    });
  }
  return matches;
}

/** The text a picked task is written as. */
export function taskReferenceText(identifier: string) {
  return `#${identifier}`;
}

/**
 * Whether a `#` typed after `before` (the text before the caret in its block) may start a
 * reference: at the block's start or after a space or punctuation, never inside a word.
 */
export function canStartTaskReference(before: string) {
  return !/[\p{L}\p{N}_#/&]$/u.test(before);
}

/** A stretch of text: plain, or a reference that resolved, each kept as it was written. */
export type ReferenceSegment =
  | { kind: 'text'; text: string }
  | { kind: 'reference'; text: string; identifier: string };

/**
 * Splits plain text into text and the references `resolves` accepts. Callers leave code and
 * link labels out: code is about its characters, and a link already goes somewhere.
 */
export function splitTaskReferences(
  text: string,
  resolves: (identifier: string) => boolean = () => true,
): ReferenceSegment[] {
  const segments: ReferenceSegment[] = [];
  let at = 0;
  for (const match of findTaskReferences(text)) {
    if (!resolves(match.identifier)) continue;
    if (match.start > at) segments.push({ kind: 'text', text: text.slice(at, match.start) });
    segments.push({
      kind: 'reference',
      text: text.slice(match.start, match.end),
      identifier: match.identifier,
    });
    at = match.end;
  }
  if (at < text.length || segments.length === 0)
    segments.push({ kind: 'text', text: text.slice(at) });
  return segments;
}
