import { type HTMLMotionProps, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type MouseEvent, type PointerEvent, useEffect, useState } from 'react';
import { afterPaint, curves, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Keeps focus where it is when a control is pressed, so a search field keeps its keyboard: the
 * keyboard stays as the person left it, and a press does not resize the whole page under the
 * drawer (on Android the WebView then painted blank frames while it caught up). A field of its
 * own, such as Find tags, still takes focus when pressed. Spread on the element holding the
 * controls.
 */
export const keepFocus = {
  onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!typesText(event.target)) event.preventDefault();
  },
  // A label passes a press to its checkbox by focusing it, which took the keyboard away too.
  onClickCapture(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    // A click from the keyboard (no presses counted) moves focus as it always has.
    if (event.detail === 0 || !(target instanceof Element)) return;
    const control = target.closest('label')?.control;
    if (!control || control.contains(target) || typesText(control)) return;
    event.preventDefault();
    control.click();
  },
};

const NOT_TEXT = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
]);

function typesText(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const field = target.closest('input, textarea, [contenteditable="true"]');
  return !!field && !(field instanceof HTMLInputElement && NOT_TEXT.has(field.type));
}

/**
 * The glass filter card that rises above a search field, for an `AnimatePresence` to mount.
 *
 * It opens and closes on transform and opacity alone: growing its height re-laid out the
 * card (and whatever sat around it) every frame and redrew its backdrop blur at each new
 * size. A uniform scale from its foot keeps the rounded corners and shadow true. The card
 * mounts hidden and starts once its sections have been drawn, so mounting them does not eat
 * the opening frames. The opacity is the card's own, never an ancestor's: a fading ancestor
 * would cut the blur off from what is behind it until the fade ended.
 *
 * `solid` draws it without a blur of its own, for a card inside a surface that is already
 * glass (the phone's drawer): the results changing under it no longer re-blur the card on every
 * frame, and at the glass's opacity the blur barely showed.
 */
export function FilterCard({
  className,
  style,
  children,
  solid = false,
  ...props
}: HTMLMotionProps<'div'> & { solid?: boolean }) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const [painted, setPainted] = useState(false);
  useEffect(() => afterPaint(() => setPainted(true)), []);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 };
  const shown = reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  return (
    <motion.div
      {...props}
      {...keepFocus}
      initial={hidden}
      animate={painted ? shown : hidden}
      exit={hidden}
      transition={reduced ? curves.fade : { ...springs.smooth, opacity: curves.fade }}
      // Closing, it leaves the field and the results under it to the pointer at once.
      inert={!present}
      style={{ transformOrigin: 'bottom center', ...style }}
      className={cn(
        'pointer-events-auto',
        solid
          ? 'border border-[var(--glass-border)] bg-popover shadow-[inset_0_1px_0_var(--glass-highlight),0_16px_40px_-12px_var(--glass-shadow)]'
          : 'glass-thick',
        !present && 'pointer-events-none',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
