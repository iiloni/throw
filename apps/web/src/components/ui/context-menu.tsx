import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { ScrollBox } from '@/components/ui/scroll-area';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/**
 * A right-click menu on the app's glass, as the shell's dropdowns are drawn: `glass-thick`,
 * rounded items that light on highlight, and the shell menu's fade and settle from the pointer
 * (`.context-menu` in styles.css). Radix gives it keyboard navigation, typeahead and the
 * Shift+F10 / Menu key opening.
 */
function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

/** Throw's hold for a menu (as the formatting bar's), sooner than Radix's fixed 700 ms. */
export const LONG_PRESS_MS = 500;
/** How far a finger may wander while held, as a card's lift allows (`Board/drag.ts`). */
const TOUCH_SLOP = 10;

/**
 * The element a right click opens the menu from. On a touch screen a long press opens it too,
 * at the finger: held still for `LONG_PRESS_MS`, within a slop so a finger's tremor does not
 * cancel it (Radix's own hold gives up on any movement). It is felt as it opens, the click the
 * lift would send is swallowed so the row under the finger does not act too, and the element
 * selects no text and shows no callout while held.
 */
function ContextMenuTrigger({
  className,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  onClickCapture,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const swallow = useRef(false);
  const release = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );
  // Opened by the hold or by the browser's own long-press `contextmenu`, whichever comes first.
  const opened = () => {
    release();
    swallow.current = true;
    haptics.longPress();
    // Only the click the lift sends, wherever the open menu lets it land; a later one, such as
    // Enter's, acts as ever.
    const lifted = () => {
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('pointercancel', lifted, true);
      window.setTimeout(() => {
        swallow.current = false;
      }, 300);
    };
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('pointercancel', lifted, true);
  };
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      disabled={disabled}
      className={cn('select-none [-webkit-touch-callout:none]', className)}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        swallow.current = false;
        release();
        if (disabled || event.pointerType === 'mouse' || event.button > 0) return;
        const target = event.currentTarget;
        const { pointerId: id, clientX: x, clientY: y } = event;
        const timer = window.setTimeout(() => {
          opened();
          target.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
            }),
          );
        }, LONG_PRESS_MS);
        press.current = { id, x, y, timer };
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const held = press.current;
        if (
          held?.id === event.pointerId &&
          Math.hypot(event.clientX - held.x, event.clientY - held.y) > TOUCH_SLOP
        )
          release();
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        release();
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        release();
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (press.current) opened();
      }}
      onClickCapture={(event) => {
        onClickCapture?.(event);
        if (!swallow.current) return;
        swallow.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      {...props}
    />
  );
}

const surface = 'context-menu glass-thick z-50 flex flex-col overflow-hidden rounded-2xl';

function ContextMenuContent({
  className,
  children,
  collisionPadding = 12,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        collisionPadding={collisionPadding}
        className={cn(surface, 'w-60 max-w-[calc(100vw-1.5rem)]', className)}
        {...props}
      >
        <ScrollBox
          className="max-h-[min(70dvh,var(--radix-context-menu-content-available-height))] [--scrollbar-inset:0.75rem]"
          viewportClassName="p-1.5"
        >
          {children}
        </ScrollBox>
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

const itemClass =
  "relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

function ContextMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive';
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        itemClass,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:*:[svg]:text-destructive!',
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(itemClass, 'pr-9', className)}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-2.5 flex size-4 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="text-foreground" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      className={cn('truncate px-2.5 pt-1.5 pb-1 text-muted-foreground text-xs', className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn('-mx-1.5 my-1.5 h-px bg-border', className)}
      {...props}
    />
  );
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(itemClass, 'data-[state=open]:bg-accent', className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

function ContextMenuSubContent({
  className,
  children,
  collisionPadding = 12,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        collisionPadding={collisionPadding}
        className={cn(surface, 'w-56 max-w-[calc(100vw-1.5rem)]', className)}
        {...props}
      >
        <ScrollBox
          className="max-h-[min(70dvh,var(--radix-context-menu-content-available-height))] [--scrollbar-inset:0.75rem]"
          viewportClassName="p-1.5"
        >
          {children}
        </ScrollBox>
      </ContextMenuPrimitive.SubContent>
    </ContextMenuPrimitive.Portal>
  );
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
