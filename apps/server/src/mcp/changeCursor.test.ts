import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type ChangeCursor,
  cursorFitsSnapshot,
  encodeChangeCursor,
  parseChangeCursor,
} from './changeCursor';

const scope = { workspaceId: randomUUID(), generation: randomUUID() };
const snapshot = '9007199254740993:9007199254740998:9007199254740993,9007199254740995';
const checkpoint: ChangeCursor = { ...scope, type: 'snapshot', snapshot };
const page: ChangeCursor = {
  ...scope,
  type: 'page',
  excludeTokenId: randomUUID(),
  base: { type: 'snapshot', snapshot },
  through: '9007199254740995:9007199254741002:9007199254740995',
  last: { id: randomUUID(), txid: '9007199254740998', source: 'structure' },
};

describe('change feed cursors', () => {
  it('round-trips a checkpoint and both kinds of continuation page without losing xid precision', () => {
    for (const cursor of [
      checkpoint,
      page,
      { ...page, base: { type: 'time', after: '2026-11-22T05:10:00-05:00' } },
    ] satisfies ChangeCursor[]) {
      const encoded = encodeChangeCursor(cursor);
      expect(encoded).toMatch(/^v1\.[\w-]+$/);
      expect(parseChangeCursor(encoded)).toEqual(cursor);
    }
  });

  it('rejects unknown versions and malformed or noncanonical payloads', () => {
    const encoded = encodeChangeCursor(checkpoint);
    for (const value of ['', `v2.${encoded.slice(3)}`, 'v1.***', 'v1.e30', `${encoded}=`])
      expect(parseChangeCursor(value)).toBeNull();
  });

  it.each([
    'bad:10:',
    '10:9:',
    '10:11',
    '10:11:11',
    '10:15:11,10',
    '10:15:10,10',
    '10:15:9',
    '10:15:10,',
    '10:15:10:',
    '10:18446744073709551616:',
  ])('refuses malformed snapshot %s before it reaches Postgres', (snapshot) => {
    expect(parseChangeCursor(encodeChangeCursor({ ...checkpoint, snapshot }))).toBeNull();
  });

  it('rejects future snapshots and page positions outside the batch', () => {
    expect(cursorFitsSnapshot(checkpoint, snapshot)).toBe(true);
    expect(cursorFitsSnapshot(page, snapshot)).toBe(false);
    expect(cursorFitsSnapshot(page, page.through)).toBe(true);
    for (const txid of ['9007199254740994', '9007199254740995', '9007199254741002']) {
      expect(cursorFitsSnapshot({ ...page, last: { ...page.last, txid } }, page.through)).toBe(
        false,
      );
    }
    expect(
      cursorFitsSnapshot(
        {
          ...page,
          last: { ...page.last, txid: '9007199254740993' },
        },
        page.through,
      ),
    ).toBe(true);
  });
});
