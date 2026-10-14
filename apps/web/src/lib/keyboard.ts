import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { animate, motionValue } from 'motion/react';
import { useEffect } from 'react';

type KeyboardAnimation = { from: number; to: number; duration: number; curve: number[] };
type Insets = { top: number; right: number; bottom: number; left: number; keyboard: number };

const KeyboardInsets = registerPlugin<{
  current(): Promise<Insets>;
  addListener(
    event: 'keyboard',
    listener: (animation: KeyboardAnimation) => void,
  ): Promise<PluginListenerHandle>;
}>('KeyboardInsets');

/** Replays Android's sampled keyboard easing without a bridge call on every frame. */
function sampledEase(curve: readonly number[]) {
  const last = curve.length - 1;
  return (t: number) => {
    if (last < 1) return t;
    const position = Math.min(Math.max(t, 0), 1) * last;
    const index = Math.floor(position);
    const from = curve[index] ?? 1;
    const to = curve[Math.min(index + 1, last)] ?? 1;
    return from + (to - from) * (position - index);
  };
}

function trackNativeKeyboard(root: HTMLElement, setHeight: (height: number) => void) {
  let disposed = false;
  let receivedEvent = false;
  const height = motionValue(0);
  const unsubscribe = height.on('change', setHeight);
  void KeyboardInsets.current().then((insets) => {
    if (disposed) return;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      root.style.setProperty(`--safe-area-inset-${side}`, `${insets[side]}px`);
    }
    if (!receivedEvent) height.jump(insets.keyboard);
  });
  const listener = KeyboardInsets.addListener('keyboard', ({ to, duration, curve }) => {
    if (disposed) return;
    receivedEvent = true;
    // Android's back/hide key should release DOM focus as well, so the next tap stays closed.
    if (to <= 0 && height.get() > 0) {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        (focused.isContentEditable || focused.matches('input, textarea, select'))
      )
        focused.blur();
    }
    height.stop();
    if (duration <= 0) height.jump(to);
    else void animate(height, to, { duration: duration / 1000, ease: sampledEase(curve) });
  });
  return () => {
    disposed = true;
    void listener.then((handle) => handle.remove());
    unsubscribe();
    height.destroy();
    setHeight(0);
  };
}

type VirtualKeyboard = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };

/** Catch's native animation tracking, with the existing browser viewport fallbacks. */
export function useKeyboardTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const setHeight = (height: number) => root.style.setProperty('--keyboard', `${height}px`);
    if (Capacitor.getPlatform() === 'android') return trackNativeKeyboard(root, setHeight);
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
