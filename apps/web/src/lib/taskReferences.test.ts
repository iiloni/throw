import { describe, expect, it } from 'vitest';
import {
  canStartTaskReference,
  findTaskReferences,
  splitTaskReferences,
  taskReferenceText,
} from './taskReferences';

const identifiers = (text: string) => findTaskReferences(text).map((match) => match.identifier);

describe('finding task references', () => {
  it('finds each #KEY-N with its offsets', () => {
    expect(findTaskReferences('See #THR-93 and #CAT2-4.')).toEqual([
      { start: 4, end: 11, identifier: 'THR-93' },
      { start: 16, end: 23, identifier: 'CAT2-4' },
    ]);
  });

  it('reads any case and upper-cases the key, as keys are stored', () => {
    expect(identifiers('#thr-93 #Thr-7')).toEqual(['THR-93', 'THR-7']);
  });

  it('stands alone at a line start, after punctuation and before punctuation', () => {
    expect(identifiers('#THR-1, (#THR-2) "#THR-3"? #THR-4.')).toEqual([
      'THR-1',
      'THR-2',
      'THR-3',
      'THR-4',
    ]);
  });

  it('leaves text that only looks like a reference', () => {
    expect(identifiers('C#THR-1 a#THR-2 ##THR-3 /docs#THR-4 &#THR-5')).toEqual([]);
    expect(identifiers('#THR-93a #THR-9_ #THR-093 #THR-0 #THR- #-4 #1A-4')).toEqual([]);
    expect(identifiers('#TOOLONG-4')).toEqual([]);
  });

  it('writes a picked task as plain text', () => {
    expect(taskReferenceText('THR-93')).toBe('#THR-93');
    expect(identifiers(`${taskReferenceText('THR-93')} `)).toEqual(['THR-93']);
  });
});

describe('splitting text by references', () => {
  it('keeps the text as written around and inside each resolved reference', () => {
    expect(
      splitTaskReferences('Blocked by #thr-2 and #THR-99.', (identifier) => identifier === 'THR-2'),
    ).toEqual([
      { kind: 'text', text: 'Blocked by ' },
      { kind: 'reference', text: '#thr-2', identifier: 'THR-2' },
      { kind: 'text', text: ' and #THR-99.' },
    ]);
  });

  it('returns plain text whole when nothing resolves', () => {
    expect(splitTaskReferences('#THR-1', () => false)).toEqual([{ kind: 'text', text: '#THR-1' }]);
    expect(splitTaskReferences('')).toEqual([{ kind: 'text', text: '' }]);
  });
});

describe('where a typed # starts a reference', () => {
  it('opens at a block start or after a space or punctuation, never inside a word', () => {
    expect(canStartTaskReference('')).toBe(true);
    expect(canStartTaskReference('See ')).toBe(true);
    expect(canStartTaskReference('(')).toBe(true);
    expect(canStartTaskReference('C')).toBe(false);
    expect(canStartTaskReference('#')).toBe(false);
    expect(canStartTaskReference('https://a.example/')).toBe(false);
  });
});
