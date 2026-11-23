import { type RefObject, useEffect } from 'react';
import { drawerTravel } from '@/components/Drawer/travel';

/**
 * Marks the drawer holding `element` with `data-covers` while it rests over the whole width
 * of the screen, and `styles.css` then stops painting the board under it.
 *
 * Narrowing the search narrows the board behind the drawer too, and the board repainted its
 * columns on every frame as their cards moved. On Android that work starved the WebView of
 * the GPU memory the drawer's own layers needed, so the results and the filter card blinked
 * out for a frame or several. Under the drawer's thick glass the board barely shows. The mark
 * waits for the drawer to come to rest and goes the moment it moves (the person dragging it,
 * or a slide), so the board is there whenever any of it can be seen.
 */
export function useCoverBoard(element: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const drawer = element.current?.closest<HTMLElement>('[data-drawer]');
    if (!drawer) return;
    let rest: string | null = null;
    let sliding = true;
    let frame = 0;
    function check() {
      frame = 0;
      if (!drawer) return;
      if (drawerTravel(drawer) !== 0) {
        sliding = true;
        drawer.removeAttribute('data-covers');
        frame = requestAnimationFrame(check);
        return;
      }
      // Where a slide ends is where the drawer rests; moving from there is a drag.
      if (sliding) rest = drawer.style.transform;
      sliding = false;
      const covers =
        drawer.style.transform === rest &&
        drawer.getBoundingClientRect().width >= document.documentElement.clientWidth - 1;
      drawer.toggleAttribute('data-covers', covers);
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    queue();
    const moves = new MutationObserver(queue);
    moves.observe(drawer, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', queue);
    return () => {
      cancelAnimationFrame(frame);
      moves.disconnect();
      window.removeEventListener('resize', queue);
      drawer.removeAttribute('data-covers');
    };
  }, [element]);
}
