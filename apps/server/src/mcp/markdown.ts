import type { CommentBody, Description } from '@throw/shared';
import type { Definition, List, ListItem, PhrasingContent, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { z } from 'zod';

type Block = CommentBody[number];
type TextStyle = Partial<Record<'bold' | 'italic' | 'code', true>>;
type StyledText = { type: 'text'; text: string; styles: TextStyle };
type Inline = StyledText | { type: 'link'; href: string; content: StyledText[] };

const supportedUrl = (href: string) => {
  if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\p{Cc}\p{Cf}]/u.test(href)) return false;
  return URL.canParse(href);
};

export class MarkdownError extends Error {}

export function markdownToBlocks(markdown: string): CommentBody {
  if (/[\uD800-\uDFFF]/u.test(markdown) || markdown.includes('\0'))
    throw new MarkdownError('Use valid Unicode text in Markdown.');
  const root = fromMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  const pending = [{ node: root as { type: string; children?: unknown[] }, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 32) throw new MarkdownError('Markdown is nested too deeply.');
    if (node.type === 'definition') {
      const definition = node as Definition;
      if (!definitions.has(definition.identifier))
        definitions.set(definition.identifier, definition);
    }
    for (const child of (node.children ?? []).toReversed()) {
      pending.push({ node: child as typeof node, depth: depth + 1 });
    }
  }

  function link(href: string, children: PhrasingContent[], styles: TextStyle): Inline {
    if (!supportedUrl(href)) throw new MarkdownError('Use an HTTP, HTTPS or mailto link.');
    const content = children.flatMap((child) => inline(child, styles));
    if (content.some((part) => part.type !== 'text'))
      throw new MarkdownError('A link cannot contain another link.');
    return { type: 'link', href, content: content.filter((part) => part.type === 'text') };
  }

  function inline(node: PhrasingContent, styles: TextStyle = {}): Inline[] {
    switch (node.type) {
      case 'text':
        return [{ type: 'text', text: node.value, styles }];
      case 'break':
        return [{ type: 'text', text: '\n', styles }];
      case 'strong':
      case 'emphasis':
        return node.children.flatMap((child) =>
          inline(child, { ...styles, [node.type === 'strong' ? 'bold' : 'italic']: true }),
        );
      case 'inlineCode':
        return [{ type: 'text', text: node.value, styles: { ...styles, code: true } }];
      case 'link':
        return [link(node.url, node.children, styles)];
      case 'linkReference': {
        const definition = definitions.get(node.identifier);
        if (!definition) throw new MarkdownError('The link reference has no destination.');
        return [link(definition.url, node.children, styles)];
      }
      default:
        throw new MarkdownError('Use text, emphasis, links and code in Markdown.');
    }
  }

  function block(node: RootContent): Block[] {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        return [
          {
            type: node.type,
            ...(node.type === 'heading' ? { props: { level: node.depth } } : {}),
            content: node.children.flatMap((child) => inline(child)),
          },
        ];
      case 'code':
        return [
          {
            type: 'codeBlock',
            props: { language: node.lang ?? 'text' },
            content: [{ type: 'text', text: node.value, styles: {} }],
          },
        ];
      case 'list':
        return node.children.map(({ children }, i) => {
          const [first, ...rest] = children;
          return {
            type: node.ordered ? 'numberedListItem' : 'bulletListItem',
            ...(node.ordered && i === 0 && node.start != null
              ? { props: { start: node.start } }
              : {}),
            content:
              first?.type === 'paragraph' ? first.children.flatMap((child) => inline(child)) : [],
            children: (first?.type === 'paragraph' ? rest : children).flatMap(block),
          };
        });
      case 'blockquote': {
        const [first, ...rest] = node.children;
        if (first?.type === 'paragraph')
          return [
            {
              type: 'quote',
              content: first.children.flatMap((child) => inline(child)),
              children: rest.flatMap(block),
            },
          ];
        return [{ type: 'quote', content: [], children: node.children.flatMap(block) }];
      }
      case 'thematicBreak':
        return [{ type: 'divider' }];
      case 'definition':
        return [];
      default:
        throw new MarkdownError(
          'Use text blocks, headings, lists, quotes, dividers and code fences.',
        );
    }
  }

  return root.children.flatMap(block);
}

const record = z.record(z.string(), z.unknown());
const headingDepth = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const asRecord = (value: unknown) => record.safeParse(value).data ?? {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Project legacy editor content to readable Markdown and flag anything altered or omitted. */
export function blocksToMarkdown(document: Description) {
  if (document === null) return { markdown: null, lossy: false };
  let lossy = false;
  let remaining = 48_000;
  let nodesLeft = 4096;

  function text(value: string) {
    const limited = value.slice(0, Math.max(0, remaining));
    remaining -= limited.length;
    if (limited.length !== value.length) lossy = true;
    return limited.replace(/[\uD800-\uDFFF]/gu, '\uFFFD');
  }

  function visit(depth: number) {
    if (depth <= 32 && nodesLeft-- > 0 && remaining > 0) return true;
    lossy = true;
    return false;
  }

  function inlineText(
    value: string,
    styles: Record<string, unknown>,
    allowBreaks: boolean,
  ): PhrasingContent[] {
    let valueText = text(value);
    if (valueText.includes('\n') && (!allowBreaks || styles.code === true)) {
      lossy = true;
      valueText = valueText.replaceAll('\n', ' ');
    }
    return valueText.split(/(\n)/).flatMap((part): PhrasingContent[] => {
      if (part === '\n') return [{ type: 'break' }];
      if (!part) return [];
      let node: PhrasingContent = {
        type: styles.code === true ? 'inlineCode' : 'text',
        value: part,
      };
      if (styles.italic === true) node = { type: 'emphasis', children: [node] };
      if (styles.bold === true) node = { type: 'strong', children: [node] };
      return [node];
    });
  }

  function inline(value: unknown, depth: number, allowBreaks: boolean): PhrasingContent[] {
    if (!visit(depth)) return [];
    if (typeof value === 'string') return inlineText(value, {}, allowBreaks);
    const row = asRecord(value);
    if (row.type === 'link') {
      const children = asArray(row.content).flatMap((child) =>
        inline(child, depth + 1, allowBreaks),
      );
      if (typeof row.href !== 'string' || row.href.length > 2048 || !supportedUrl(row.href)) {
        lossy = true;
        return children;
      }
      return [{ type: 'link', url: text(row.href), children }];
    }
    if (row.type !== 'text' || typeof row.text !== 'string') {
      lossy = true;
      return [];
    }

    const styles = asRecord(row.styles);
    if (Object.keys(styles).some((style) => !['bold', 'italic', 'code'].includes(style)))
      lossy = true;
    return inlineText(row.text, styles, allowBreaks);
  }

  function content(value: unknown, depth: number, allowBreaks = true): PhrasingContent[] {
    const children = (typeof value === 'string' ? [value] : asArray(value)).flatMap((item) =>
      inline(item, depth, allowBreaks),
    );
    // A hard break needs a following line in the same Markdown block.
    while (children.at(-1)?.type === 'break') {
      children.pop();
      lossy = true;
    }
    return children;
  }

  function code(value: unknown, depth: number): string {
    if (typeof value === 'string') return text(value);
    return asArray(value)
      .map((part) => {
        if (!visit(depth)) return '';
        const row = asRecord(part);
        if (row.type === 'text' && typeof row.text === 'string') return text(row.text);
        lossy = true;
        return '';
      })
      .join('');
  }

  function blocks(values: unknown[], depth: number): RootContent[] {
    const result: RootContent[] = [];
    let list: List | undefined;
    for (const value of values) {
      if (!visit(depth)) break;
      const row = asRecord(value);
      const props = asRecord(row.props);
      if (
        (props.textAlignment && props.textAlignment !== 'left') ||
        (props.textColor && props.textColor !== 'default') ||
        (props.backgroundColor && props.backgroundColor !== 'default') ||
        props.isToggleable === true
      )
        lossy = true;
      const nested = blocks(asArray(row.children), depth + 1);
      if (row.type === 'codeBlock') {
        const language =
          typeof props.language === 'string' && /^[\w+.-]{1,40}$/.test(props.language)
            ? props.language
            : null;
        result.push(
          {
            type: 'code',
            value: code(row.content, depth + 1),
            lang: language === 'text' ? null : language,
          },
          ...nested,
        );
        list = undefined;
        continue;
      }
      if (row.type === 'table') {
        lossy = true;
        for (const tableRow of asArray(asRecord(row.content).rows)) {
          if (!visit(depth + 1)) break;
          const children = asArray(asRecord(tableRow).cells).flatMap((cell, index) => [
            ...(index ? [{ type: 'text', value: ' | ' } as const] : []),
            ...content(
              typeof cell === 'string' || Array.isArray(cell) ? cell : asRecord(cell).content,
              depth + 2,
            ),
          ]);
          result.push({ type: 'paragraph', children });
        }
        result.push(...nested);
        list = undefined;
        continue;
      }

      const level = headingDepth.safeParse(props.level).data ?? 1;
      // Setext headings allow line breaks, while level 3–6 headings must fit on one line.
      const children = content(row.content, depth + 1, row.type !== 'heading' || level <= 2);
      if (
        row.type === 'bulletListItem' ||
        row.type === 'numberedListItem' ||
        row.type === 'checkListItem'
      ) {
        const ordered = row.type === 'numberedListItem';
        const start =
          typeof props.start === 'number' && Number.isSafeInteger(props.start)
            ? props.start
            : undefined;
        if (!list || list.ordered !== ordered || start !== undefined) {
          list = { type: 'list', ordered, start, children: [] };
          result.push(list);
        }
        if (row.type === 'checkListItem') {
          lossy = true;
          children.unshift({ type: 'text', value: props.checked === true ? '[x] ' : '[ ] ' });
        }
        const item: ListItem = {
          type: 'listItem',
          children: [{ type: 'paragraph', children }, ...(nested as ListItem['children'])],
        };
        list.children.push(item);
        continue;
      }
      list = undefined;
      switch (row.type) {
        case 'paragraph':
          if (children.length) result.push({ type: 'paragraph', children });
          if (nested.length) lossy = true;
          result.push(...nested);
          break;
        case 'heading':
          result.push({ type: 'heading', depth: level, children }, ...nested);
          if (nested.length) lossy = true;
          break;
        case 'quote':
          result.push({
            type: 'blockquote',
            children: [
              ...(children.length ? [{ type: 'paragraph', children } as const] : []),
              ...(nested as ListItem['children']),
            ],
          });
          break;
        case 'divider':
          result.push({ type: 'thematicBreak' }, ...nested);
          if (nested.length) lossy = true;
          break;
        default:
          lossy = true;
          if (children.length) result.push({ type: 'paragraph', children });
          result.push(...nested);
      }
    }
    return result;
  }

  const markdown = toMarkdown(
    { type: 'root', children: blocks(document, 0) },
    { fences: true },
  ).trimEnd();
  return { markdown, lossy };
}
