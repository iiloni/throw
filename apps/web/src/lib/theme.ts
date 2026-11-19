import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { usePersistentState } from './storage';

export const THEME_KEY = 'throw-theme';

const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export function useThemePreference() {
  return usePersistentState(THEME_KEY, themePreferenceSchema, 'system');
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribeToSystemTheme(listener: () => void) {
  const query = darkQuery();
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** The theme actually shown: the stored preference, or the OS setting for `system`. */
export function useResolvedTheme(): 'light' | 'dark' {
  const [preference] = useThemePreference();
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, () => darkQuery().matches);
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Points the browser's and installed app's bars at the chosen theme's color: index.html
 * holds one `theme-color` per scheme, and an explicit theme overrides the OS setting.
 */
export function applyThemeColor(preference: ThemePreference) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"][data-scheme]',
  )) {
    const scheme = meta.dataset.scheme;
    meta.media =
      preference === 'system'
        ? `(prefers-color-scheme: ${scheme})`
        : preference === scheme
          ? 'all'
          : 'not all';
  }
}

/**
 * Mirrors the preference onto <html data-theme>, which the CSS tokens read, and onto the
 * `theme-color` tags. index.html applies the stored value before first paint to avoid a flash.
 */
export function useApplyTheme() {
  const [preference] = useThemePreference();
  useEffect(() => {
    if (preference === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = preference;
    applyThemeColor(preference);
  }, [preference]);
}
