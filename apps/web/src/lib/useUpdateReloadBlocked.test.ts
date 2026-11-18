import { describe, expect, it } from 'vitest';
import { holdUpdateReload, isUpdateReloadBlocked } from './useUpdateReloadBlocked';

describe('update reload guard', () => {
  it('stays blocked until every holder has released, each only once', () => {
    const form = holdUpdateReload();
    const editor = holdUpdateReload();
    form();
    form();
    expect(isUpdateReloadBlocked()).toBe(true);
    editor();
    expect(isUpdateReloadBlocked()).toBe(false);
  });
});
