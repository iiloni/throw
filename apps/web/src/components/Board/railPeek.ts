/**
 * A collapsed rail opened for a glance: a mouse resting on its strip opens it over the columns,
 * and it goes back to its strip shortly after the pointer leaves. What the rail is told to do
 * (open, close, whether something still keeps it open) is the host's; this is only the timing.
 */

/** How long a mouse rests on a strip before it opens for a glance. */
export const PEEK_DWELL_MS = 1000;
/** How long a peeked rail waits after the pointer leaves it before it goes back to its strip. */
export const PEEK_GRACE_MS = 400;

export type RailPeekHost = {
  /** Whether the strip may open now: nothing is held or carried, and it is still a strip. */
  canOpen(): boolean;
  open(): void;
  /** Whether the rail is showing open for a glance. */
  isOpen(): boolean;
  /**
   * Whether something begun in the rail still needs it: its edge held, or a menu or popover
   * open. The rail is asked again once the grace has run once more.
   */
  isHeld(): boolean;
  close(): void;
  /** A dwell has started or stopped, for the strip to show how long is left of it. */
  dwelling?(active: boolean): void;
};

export type RailPeek = ReturnType<typeof createRailPeek>;

export function createRailPeek(host: RailPeekHost) {
  let dwell: number | undefined;
  let grace: number | undefined;
  let inside = false;

  const stopDwell = () => {
    if (dwell === undefined) return;
    window.clearTimeout(dwell);
    dwell = undefined;
    host.dwelling?.(false);
  };
  const stopGrace = () => {
    window.clearTimeout(grace);
    grace = undefined;
  };
  const scheduleClose = () => {
    stopGrace();
    grace = window.setTimeout(function check() {
      grace = undefined;
      if (inside || !host.isOpen()) return;
      // Whatever keeps it open is asked again, so the rail goes once it has finished.
      if (host.isHeld()) grace = window.setTimeout(check, PEEK_GRACE_MS);
      else host.close();
    }, PEEK_GRACE_MS);
  };

  /** A pointer came onto the strip: only a mouse's rest opens it, never a touch or a pen. */
  const enterStrip = (pointerType: string) => {
    stopDwell();
    if (pointerType !== 'mouse' || !host.canOpen()) return;
    dwell = window.setTimeout(() => {
      dwell = undefined;
      host.dwelling?.(false);
      if (!host.canOpen()) return;
      inside = true;
      host.open();
    }, PEEK_DWELL_MS);
    host.dwelling?.(true);
  };

  return {
    enterStrip,
    /**
     * A pointer moving on the strip without a dwell under way: the strip appeared under it (a
     * rail closed where it rests, a panel fading out over it), so no enter came, or its last
     * dwell was cut short by something now finished. A held button is a press, not a rest.
     */
    moveOnStrip(pointerType: string, pressed: boolean) {
      if (pressed || dwell !== undefined || host.isOpen()) return;
      enterStrip(pointerType);
    },
    /** Left, pressed or otherwise used before it opened: the strip keeps to its own press. */
    cancelDwell: stopDwell,
    /** The pointer is over the open rail, or anything it opened. */
    enter() {
      inside = true;
      stopGrace();
    },
    leave() {
      inside = false;
      if (host.isOpen()) scheduleClose();
    },
    /** The rail was opened for good, or closed some other way: nothing is left to time. */
    settle() {
      stopDwell();
      stopGrace();
    },
    dispose() {
      stopDwell();
      stopGrace();
    },
  };
}
