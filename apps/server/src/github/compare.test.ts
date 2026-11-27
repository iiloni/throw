import { afterEach, expect, it, vi } from 'vitest';
import { containsMerge } from './compare';

afterEach(() => vi.unstubAllGlobals());
it.each([
  ['ahead', true],
  ['identical', true],
  ['behind', false],
  ['diverged', false],
  ['unknown', null],
] as const)('interprets compare status %s', async (status, expected) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status }));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await containsMerge('acme/app', 'release/v1', 'abc', 'test', new AbortController().signal),
  ).toBe(expected);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    'https://api.github.com/repos/acme/app/compare/abc...release%2Fv1?per_page=1',
  );
});
it('falls back when compare is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  expect(
    await containsMerge('acme/app', 'v1', 'abc', 'test', new AbortController().signal),
  ).toBeNull();
});
