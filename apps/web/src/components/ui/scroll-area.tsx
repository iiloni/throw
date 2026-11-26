import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Marks the root with `data-more-top` and `data-more-bottom` while its viewport has content
 * scrolled out that way, and with `sides`, `data-more-left` and `data-more-right` too. Written
 * to the element, not to state: it changes on every scroll.
 */
function useEdges(enabled: boolean, sides: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const viewport = root?.querySelector<HTMLElement>(
      ':scope > [data-slot="scroll-area-viewport"]',
    );
    if ((!enabled && !sides) || !root || !viewport) return;
    const measure = () => {
      if (enabled) {
        const below = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
        root.toggleAttribute('data-more-top', viewport.scrollTop > 1);
        root.toggleAttribute('data-more-bottom', below > 1);
      }
      if (sides) {
        const after = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft;
        root.toggleAttribute('data-more-left', viewport.scrollLeft > 1);
        root.toggleAttribute('data-more-right', after > 1);
      }
    };
    measure();
    viewport.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const content = viewport.firstElementChild;
    // A row's content box keeps the viewport's width while what it holds runs on past it, so
    // the scroll width changes with its children (a column folding, a rail springing open)
    // and with neither a scroll nor a resize of the viewport. They are watched one by one.
    const watch = () => {
      if (!observer) return;
      observer.disconnect();
      observer.observe(viewport);
      if (content) observer.observe(content);
      if (sides && content) for (const child of content.children) observer.observe(child);
    };
    watch();
    const children =
      sides && content && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(watch)
        : null;
    if (content) children?.observe(content, { childList: true });
    return () => {
      viewport.removeEventListener('scroll', measure);
      observer?.disconnect();
      children?.disconnect();
    };
  }, [enabled, sides]);
  return ref;
}

/**
 * Catch's overlay scrollbars: a thin rounded thumb drawn over the content, never beside it.
 * With `edges`, content fades out at the top or bottom while there is more that
 * way, so the area says it scrolls without showing a bar. With `sides`, the root is marked
 * while content is scrolled out to the left or right, for a surface to fade that edge itself.
 */
function ScrollArea({
  className,
  type = 'hover',
  edges = false,
  sides = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & { edges?: boolean; sides?: boolean }) {
  const ref = useEdges(edges, sides);
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      data-edges={edges ? '' : undefined}
      type={type}
      className={cn('relative min-h-0 min-w-0', className)}
      {...props}
    />
  );
}

function ScrollAreaViewport({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>) {
  return (
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      // Replace Radix's table wrapper so content wraps and a short list can fill the area.
      // No overscroll of the browser's own: `lib/scrollBounce.ts` bounces the content at its
      // ends, and Android's stretch would play on top of it. `none` still keeps the scroll from
      // chaining to the page, as `contain` did. On a touch screen, where flings reach the ends,
      // the content keeps a layer of its own, so a bounce moves it from its first frame rather
      // than dropping frames while one is made.
      className={cn(
        'size-full rounded-[inherit] overscroll-y-none outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:min-h-full [&>div]:flex-col [&>div]:!flex pointer-coarse:[&>div]:will-change-transform',
        className,
      )}
      {...props}
    />
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  style,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // Touch screens scroll by touch; a bar there is only noise.
        'group z-10 flex touch-none select-none p-[3px] transition-opacity duration-200 data-[state=hidden]:opacity-0 pointer-coarse:hidden',
        orientation === 'vertical' ? 'w-3' : 'h-3 flex-col',
        className,
      )}
      style={{
        ...(orientation === 'vertical'
          ? {
              top: 'var(--scrollbar-inset, 0px)',
              bottom: 'var(--scrollbar-inset, 0px)',
              right: 'var(--scrollbar-edge, 0px)',
            }
          : {
              left: 'var(--scrollbar-inset, 0px)',
              right: 'var(--scrollbar-inset, 0px)',
              bottom: 'var(--scrollbar-edge, 0px)',
            }),
        ...style,
      }}
      onMouseDown={(event) => {
        // Keep the editor's caret (and any focused field) while Radix drags the thumb.
        event.preventDefault();
        onMouseDown?.(event);
      }}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-muted-foreground/65 group-active:bg-muted-foreground/80"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

/**
 * A list, menu or panel that grows with its content and scrolls under Catch's overlay bar once
 * it reaches its `max-h-*`, or the room its flex parent leaves it. The viewport takes the
 * root's maximum height, so a box sized by its content needs no fixed height.
 */
function ScrollBox({
  className,
  viewportClassName,
  viewportRef,
  viewportProps,
  children,
  ...props
}: React.ComponentProps<typeof ScrollArea> & {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: Omit<React.ComponentProps<typeof ScrollAreaViewport>, 'className' | 'ref'>;
}) {
  return (
    <ScrollArea className={cn('flex flex-col', className)} {...props}>
      <ScrollAreaViewport
        ref={viewportRef}
        className={cn('h-auto max-h-[inherit] min-h-0 flex-1', viewportClassName)}
        {...viewportProps}
      >
        {children}
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollArea>
  );
}

export { ScrollArea, ScrollAreaViewport, ScrollBar, ScrollBox };
