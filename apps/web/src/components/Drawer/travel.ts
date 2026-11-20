const travels = new WeakMap<Element, () => number>();

/** A drawer reports how far it still has to move; returns the cleanup. */
export function trackDrawerTravel(drawer: Element, travel: () => number) {
  travels.set(drawer, travel);
  return () => {
    travels.delete(drawer);
  };
}

/**
 * How much further down the drawer holding `element` moves before it comes to rest: negative
 * while it rises, 0 at rest or outside a drawer. A task closing into a card in the backlog
 * aims for where that card will be, not where the rising drawer has carried it so far.
 */
export function drawerTravel(element: Element) {
  const drawer = element.closest('[data-drawer]');
  return drawer ? (travels.get(drawer)?.() ?? 0) : 0;
}
