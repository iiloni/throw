import { createStore } from './store';

// Shell forms hold drafts outside the outbox. Editors can acquire the same guard.
export const updateReloadBlocked = createStore(false);
export const isUpdateReloadBlocked = updateReloadBlocked.get;
export const useUpdateReloadBlocked = updateReloadBlocked.use;
