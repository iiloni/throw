import { createStore } from './store';

/** How many holders keep an update from reloading the app, such as a shell form's draft. */
const holders = createStore(0);

/**
 * Keeps an update's reload away while something holds a draft outside the outbox. Each
 * holder releases only its own hold, so one closing does not unblock another.
 */
export function holdUpdateReload() {
  holders.set(holders.get() + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders.set(holders.get() - 1);
  };
}

export const isUpdateReloadBlocked = () => holders.get() > 0;
export const useUpdateReloadBlocked = () => holders.use() > 0;
/** Calls back whenever a hold is taken or released. Returns the unsubscribe. */
export const watchUpdateReloadBlocked = (listener: () => void): (() => void) => {
  const stop = holders.subscribe(listener);
  return () => void stop();
};
