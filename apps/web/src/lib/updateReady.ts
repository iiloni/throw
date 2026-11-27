import { useAndroidUpdateAvailable } from './updates';
import { useWebUpdates } from './webUpdates';

/** Read by assistive technology where `UpdateDot` marks a control, which it does only visually. */
export const UPDATE_READY_DESCRIPTION = 'Update available';

/** Whether an update is waiting: a newer Android app, or a new web build ready to load. */
export function useUpdateReady() {
  const android = useAndroidUpdateAvailable();
  const { target } = useWebUpdates();
  return android || target !== null;
}
