import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';
import { createContext, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
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
  return (
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
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { variant?: 'default' | 'glass' }) {
  // A closed tooltip leaves at once. Radix keeps one mounted until its animation ends, even
  // its entry when it closes that early, and a mounted tooltip still takes the next Escape:
  // that Escape would dismiss a tooltip that is already gone instead of what the user meant.
  if (!useContext(TooltipOpen)) return null;
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'fade-in-0 zoom-in-95 z-50 animate-in rounded-md px-3 py-1.5 text-xs',
          variant === 'glass' ? 'glass text-foreground' : 'bg-primary text-primary-foreground',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
