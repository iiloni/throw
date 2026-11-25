import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';
import { createContext, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

const Provided = createContext(false);

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <Provided.Provider value>
      <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
    </Provided.Provider>
  );
}

const TooltipOpen = createContext(false);

function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const tooltip = (
    <TooltipOpen.Provider value={open}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        onOpenChange={(next) => {
          setUncontrolled(next);
          onOpenChange?.(next);
        }}
        {...props}
      />
    </TooltipOpen.Provider>
  );
  // The root mounts one provider, so hints share its delay. One rendered on its own (a test,
  // a preview) brings its own rather than throwing.
  return useContext(Provided) ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Throw's frosted glass, thick enough for text over tinted cards and colored columns, with
 * foreground text in both themes. Contents sit in a row, so a shortcut's keycaps can follow
 * the label; long text wraps within the window.
 */
function TooltipContent({
  className,
  sideOffset = 6,
  // Clear of the window's edge, so a hint beside the rail's last button is not cut off.
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  // A closed tooltip leaves at once. Radix keeps one mounted until its animation ends, even
  // its entry when it closes that early, and a mounted tooltip still takes the next Escape:
  // that Escape would dismiss a tooltip that is already gone instead of what the user meant.
  if (!useContext(TooltipOpen)) return null;
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Above every layer a hint can sit on: the drawer, dialogs and the palette (`z-[70]`).
          'glass-thick z-[75] flex max-w-[min(24rem,calc(100vw-2rem))] items-center gap-2 wrap-anywhere rounded-md px-2.5 py-1.5 font-medium text-[0.8125rem] text-foreground leading-snug',
          // The thick glass's drop shadow is sized for menus; a hint sits closer to the page.
          'shadow-[inset_0_1px_0_var(--glass-highlight),0_6px_20px_-6px_var(--glass-shadow)]!',
          // Grows out of its trigger; reduced motion keeps only the fade.
          'fade-in-0 origin-(--radix-tooltip-content-transform-origin) animate-in duration-200 ease-(--ease-emphasized)',
          'motion-safe:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-[2px] motion-safe:data-[side=left]:slide-in-from-right-[2px] motion-safe:data-[side=right]:slide-in-from-left-[2px] motion-safe:data-[side=top]:slide-in-from-bottom-[2px]',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
