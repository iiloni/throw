import { type ReactNode, useCallback, useContext } from 'react';
import { DrawerBridge } from '@/components/Drawer/DrawerHost';
import { TaskBlockersContext } from './blockers';
import { TaskPullRequestsContext } from './githubLinks';
import { SelectionContentContext, TaskContentContext } from './taskContent';

/**
 * Carries a board boundary's contexts into the shell's drawer, which draws the board's backlog,
 * dock, pages and move target outside the board's tree (ADR 0009). A context the boundary adds
 * for its cards or task content joins it here too.
 */
export function BoardDrawerBridge({ children }: { children: ReactNode }) {
  const task = useContext(TaskContentContext);
  const blockers = useContext(TaskBlockersContext);
  const pulls = useContext(TaskPullRequestsContext);
  const selection = useContext(SelectionContentContext);
  const wrap = useCallback(
    (node: ReactNode) => (
      <TaskContentContext.Provider value={task}>
        <TaskBlockersContext.Provider value={blockers}>
          <TaskPullRequestsContext.Provider value={pulls}>
            <SelectionContentContext.Provider value={selection}>
              {node}
            </SelectionContentContext.Provider>
          </TaskPullRequestsContext.Provider>
        </TaskBlockersContext.Provider>
      </TaskContentContext.Provider>
    ),
    [task, blockers, pulls, selection],
  );
  return <DrawerBridge wrap={wrap}>{children}</DrawerBridge>;
}
