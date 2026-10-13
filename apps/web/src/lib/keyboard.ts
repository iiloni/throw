import { useEffect } from 'react';

type VirtualKeyboard = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };

/** Catch's browser inset handling; native keyboard animations stay with the Android work. */
export function useKeyboardTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const setHeight = (height: number) => root.style.setProperty('--keyboard', `${height}px`);
    const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard })
      .virtualKeyboard;
    if (keyboard) {
      const previous = keyboard.overlaysContent;
      keyboard.overlaysContent = true;
      const update = () => setHeight(keyboard.boundingRect.height);
      keyboard.addEventListener('geometrychange', update);
      update();
      return () => {
        keyboard.removeEventListener('geometrychange', update);
        keyboard.overlaysContent = previous;
        setHeight(0);
      };
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const focused = document.activeElement;
      const editing =
        focused instanceof HTMLElement &&
        (focused.isContentEditable || focused.matches('input, textarea'));
      // Pinch zoom also shrinks the visual viewport; it must not lift the dock.
      setHeight(
        editing && Math.abs(viewport.scale - 1) < 0.01
          ? Math.max(0, root.clientHeight - viewport.height - viewport.offsetTop)
          : 0,
      );
    };
    const blur = () => queueMicrotask(update);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', blur);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', blur);
      setHeight(0);
    };
  }, []);
}
