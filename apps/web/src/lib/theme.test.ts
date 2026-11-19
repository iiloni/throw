import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemeColor } from './theme';

function metas() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => [
    meta.dataset.scheme,
    meta.media,
  ]);
}

describe('applyThemeColor', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" data-scheme="light" media="(prefers-color-scheme: light)" content="#f7f6f2" />
      <meta name="theme-color" data-scheme="dark" media="(prefers-color-scheme: dark)" content="#23211e" />`;
  });

  it('pins the bars to an explicit theme', () => {
    applyThemeColor('dark');
    expect(metas()).toEqual([
      ['light', 'not all'],
      ['dark', 'all'],
    ]);
    applyThemeColor('light');
    expect(metas()).toEqual([
      ['light', 'all'],
      ['dark', 'not all'],
    ]);
  });

  it('hands the bars back to the OS for the system theme', () => {
    applyThemeColor('dark');
    applyThemeColor('system');
    expect(metas()).toEqual([
      ['light', '(prefers-color-scheme: light)'],
      ['dark', '(prefers-color-scheme: dark)'],
    ]);
  });
});
