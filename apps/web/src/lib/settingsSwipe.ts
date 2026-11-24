import { motionValue, useReducedMotion, useTransform } from 'motion/react';

/** Shared by the settings content so a pull moves it together while respecting reduced motion. */
export const settingsDragY = motionValue(0);

export function useSettingsSwipeY() {
  const reducedMotion = useReducedMotion();
  return useTransform(() => (reducedMotion ? 0 : settingsDragY.get()));
}
