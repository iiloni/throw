import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Tests run from the web app's directory.
const src = join(process.cwd(), 'src');

/**
 * Where a source sets a native `title` on a DOM element (`<button title=…>`, `<motion.span
 * title=…>`) or draws an SVG `<title>`. Components' own `title` props are headings and pass.
 */
function nativeTitles(source: string) {
  const lines: number[] = [];
  const line = (index: number) => source.slice(0, index).split('\n').length;
  for (const match of source.matchAll(/<([a-z][\w-]*(?:\.[\w-]+)?)(?=[\s/>])/g)) {
    if (match[1] === 'title') {
      lines.push(line(match.index));
      continue;
    }
    // The opening tag's own text, leaving out expressions and strings, up to its `>`.
    let attributes = '';
    let depth = 0;
    let quote: string | null = null;
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const char = source[i]!;
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
      else if (depth === 0) attributes += char;
    }
    if (/(^|\s)title=/.test(attributes)) lines.push(line(match.index));
  }
  return lines;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

it('finds native titles, and not title props or expressions', () => {
  expect(nativeTitles('<button type="button" title="Close" />')).toEqual([1]);
  expect(nativeTitles('<motion.span\n  className="x"\n  title={label}\n>')).toEqual([1]);
  expect(nativeTitles('<svg>\n  <title>Logo</title>\n</svg>')).toEqual([2]);
  expect(nativeTitles('<Dialog title="Rename" />')).toEqual([]);
  expect(nativeTitles('<button onClick={() => open({ title: "x" })} aria-label="Go">')).toEqual([]);
  expect(nativeTitles('const [a] = useState<boolean>(false);')).toEqual([]);
});

// Throw's hints are tooltips (`Hint`, `IconButton`): a native title looks foreign, waits a
// browser's delay, and shows on no touch screen.
it('uses Throw tooltips instead of native titles', () => {
  const found = sources(src).flatMap((file) =>
    nativeTitles(readFileSync(file, 'utf8')).map((at) => `${relative(src, file)}:${at}`),
  );
  expect(found).toEqual([]);
});
