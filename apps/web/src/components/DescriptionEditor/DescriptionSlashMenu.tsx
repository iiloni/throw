import { type FloatingUIOptions, SuggestionMenuController } from '@blocknote/react';
import { type Middleware, offset, type ReferenceElement, shift, size } from '@floating-ui/react';

const PADDING = 10;

function inset(name: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/**
 * Where a menu beside the caret may open: the window, less the keyboard, and the part of the
 * task's scroll area that no dock or toolbar covers. Those declare themselves as the area's
 * scroll padding (see DescriptionEditor), so the menu never opens under them.
 */
function menuBounds(reference: ReferenceElement) {
  const element = reference instanceof Element ? reference : reference.contextElement;
  let top = inset('--safe-top');
  let bottom = window.innerHeight - Math.max(inset('--keyboard'), inset('--safe-bottom'));
  const area = element?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (area) {
    const rect = area.getBoundingClientRect();
    const style = getComputedStyle(area);
    top = Math.max(top, rect.top + (Number.parseFloat(style.scrollPaddingTop) || 0));
    bottom = Math.min(bottom, rect.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0));
  }
  return { x: 0, y: top, width: window.innerWidth, height: Math.max(0, bottom - top) };
}

// Size middleware scrolls a tall menu, so choosing a side by the menu's measured height would
// keep it on whichever side was measured first. Catch's rule: the side with more room.
const chooseMenuSide: Middleware = {
  name: 'chooseMenuSide',
  fn({ elements, placement }) {
    const caret = elements.reference.getBoundingClientRect();
    const bounds = menuBounds(elements.reference);
    const above = caret.top - bounds.y;
    const below = bounds.y + bounds.height - caret.bottom;
    const preferred = above > below ? 'top-start' : 'bottom-start';
    return placement === preferred ? {} : { reset: { placement: preferred } };
  },
};

/** Where the editor's suggestion menus (`/`, `#`) open. */
export const suggestionMenuFloatingOptions: FloatingUIOptions = {
  useFloatingOptions: {
    placement: 'bottom-start',
    middleware: [
      chooseMenuSide,
      offset(PADDING),
      shift(({ elements }) => ({
        rootBoundary: menuBounds(elements.reference),
        padding: PADDING,
      })),
      size(({ elements }) => ({
        rootBoundary: menuBounds(elements.reference),
        padding: PADDING,
        apply({ elements, availableHeight, availableWidth }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
        },
      })),
    ],
    // The keyboard and dock move the bounds without moving the caret.
    whileElementsMounted(_reference, _floating, update) {
      const observer = new MutationObserver(update);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
      return () => observer.disconnect();
    },
  },
};

/** BlockNote's slash menu, kept clear of the window's edges, the keyboard and the dock. */
export function DescriptionSlashMenu() {
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      shouldOpen={(state) => !state.selection.$from.parent.type.isInGroup('tableContent')}
      floatingUIOptions={suggestionMenuFloatingOptions}
    />
  );
}
