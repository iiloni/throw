import { describe, expect, it } from 'vitest';
import { normalizeCodeIndentation } from './codeSnippet';
import { detectCodeLanguage } from './detectCodeLanguage';

describe('code paste indentation', () => {
  it('normalizes line endings and removes the common margin', () => {
    expect(
      normalizeCodeIndentation('    function greet() {\r\n      return "hello";\r\n    }\r'),
    ).toBe('function greet() {\n  return "hello";\n}\n');
  });

  it('keeps relative indentation and remaining tabs', () => {
    expect(normalizeCodeIndentation('\tprepare:\n\t\techo hello\n\n\tnext:')).toBe(
      'prepare:\n\techo hello\n\nnext:',
    );
  });

  it('handles cuts inside a tab stop and follows the current line on later pasted lines', () => {
    expect(normalizeCodeIndentation(' leading\n\tmore\n\n last', '  ')).toBe(
      'leading\n   more\n\n  last',
    );
  });

  it('preserves aligned code and whitespace-only pastes', () => {
    expect(normalizeCodeIndentation('first\n  second')).toBe('first\n  second');
    expect(normalizeCodeIndentation(' \t\r\n\t')).toBe(' \t\n\t');
  });
});

describe('offline language detection', () => {
  it.each([
    ['{"ready":true,"count":3}', 'json'],
    ['def greet(name):\n    print(name)', 'python'],
    ['const label: string = "ship";', 'typescript'],
    ['const label = "ship";\nconsole.log(label);', 'javascript'],
    [
      'diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-old\n+new',
      'diff',
    ],
  ])('detects %s from local grammars', (source, language) => {
    expect(detectCodeLanguage(source)).toBe(language);
  });

  it.each(['hello', 'Please remember to bring a water bottle.'])(
    'leaves ambiguous text unlabelled (%s)',
    (source) => expect(detectCodeLanguage(source)).toBeUndefined(),
  );
});
