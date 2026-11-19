import { useCallback, useSyncExternalStore } from 'react';

export function useMedia(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * The one desktop breakpoint, in Tailwind's terms (`md` is `width >= 48rem`), so script and
 * styles agree at any font size and at fractional widths. A phone is anything narrower.
 */
export const DESKTOP_QUERY = '(width >= 48rem)';

export function useDesktop() {
  return useMedia(DESKTOP_QUERY);
}

// Outside a browser (unit tests without matchMedia) the width alone decides.
export const isDesktop = () =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(DESKTOP_QUERY).matches
    : window.innerWidth >= 768;
