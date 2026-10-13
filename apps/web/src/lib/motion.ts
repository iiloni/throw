import type { Transition } from 'motion/react';

// Catch's interruptible springs: controls feel quick; changing surfaces settle softly.
export const springs = {
  snappy: { type: 'spring', visualDuration: 0.3, bounce: 0.2 },
  smooth: { type: 'spring', visualDuration: 0.4, bounce: 0.15 },
} satisfies Record<string, Transition>;
