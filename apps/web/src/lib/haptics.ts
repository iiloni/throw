import { Capacitor, registerPlugin } from '@capacitor/core';
import type { StatusCategory } from '@throw/shared';

type Effect = 'tick' | 'light' | 'medium' | 'success' | 'warning' | 'threshold';

// A local plugin in the Android project (HapticFeedbackPlugin.java), ported from Catch.
const HapticFeedback = registerPlugin<{ perform(options: { effect: Effect }): Promise<void> }>(
  'HapticFeedback',
);

const native = Capacitor.isNativePlatform();

function perform(effect: Effect) {
  if (native) void HapticFeedback.perform({ effect }).catch(() => {});
  // A browser on a phone has only raw vibration, which Android Chrome honours only once the
  // page has been tapped; before that it blocks each call with a console warning.
  else if (navigator.userActivation?.hasBeenActive ?? true)
    navigator.vibrate?.(effect === 'medium' ? 12 : effect === 'success' ? 14 : 8);
}

/**
 * Haptics named by what happened, so components never choose raw strengths. Native ones use
 * the device's tuned effects and respect its touch feedback setting.
 */
export const haptics = {
  /** A choice among several: a page, a tab, a picker's option, or a held card's new target. */
  selection: () => perform('tick'),
  /** A control changes state: a switch flips, a sheet or form opens. */
  toggle: () => perform('light'),
  /** A long press picks up a card or starts selecting cards. */
  longPress: () => perform('medium'),
  /** Something was made or put in place: a card dropped, a task created, a comment posted. */
  success: () => perform('success'),
  /** A drag crossed the point where letting go commits, such as turning a page. */
  threshold: () => perform('threshold'),
  /** Something destructive, such as moving to the trash or removing for good. */
  warning: () => perform('warning'),
};

/** A task changes status: finishing it lands as an accomplishment, anything else as a choice. */
export function feelStatusChange(category: StatusCategory) {
  if (category === 'done') haptics.success();
  else haptics.selection();
}
