import { Capacitor, registerPlugin } from '@capacitor/core';

type Effect = 'tick' | 'light' | 'medium' | 'success' | 'warning' | 'threshold';

// A local plugin in the Android project (HapticFeedbackPlugin.java), ported from Catch.
const HapticFeedback = registerPlugin<{ perform(options: { effect: Effect }): Promise<void> }>(
  'HapticFeedback',
);

const native = Capacitor.isNativePlatform();

function perform(effect: Effect) {
  if (native) void HapticFeedback.perform({ effect }).catch(() => {});
  // A browser on a phone has only raw vibration, which Android Chrome honours after a touch.
  else navigator.vibrate?.(effect === 'medium' ? 12 : effect === 'success' ? 14 : 8);
}

/**
 * Haptics named by what happened, so components never choose raw strengths. Native ones use
 * the device's tuned effects and respect its touch feedback setting.
 */
export const haptics = {
  /** A held card passes onto a new target. */
  selection: () => perform('tick'),
  /** A long press picks up a card or starts selecting cards. */
  longPress: () => perform('medium'),
  /** A card was dropped into place. */
  success: () => perform('success'),
  /** A drag crossed the point where letting go commits, such as turning a page. */
  threshold: () => perform('threshold'),
  /** Something destructive. */
  warning: () => perform('warning'),
};
