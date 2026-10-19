import type { Project, Workspace } from '@throw/shared';
import { createContext, useContext } from 'react';
import { z } from 'zod';
import type { PaletteMode } from '@/components/CommandPalette/CommandPalette';
import type { ShellForm } from '@/components/ShellForms/ShellForms';

export const viewSchema = z.enum(['backlog', 'board', 'search']);
export type ProjectView = z.infer<typeof viewSchema>;
export const navigationSchema = z.object({
  workspaceId: z.string().nullable(),
  projects: z.record(z.string(), z.string()),
});
export type ShellState = {
  workspaces: Workspace[];
  projects: Project[];
  workspace?: Workspace;
  project?: Project;
  awaitingWorkspaces: boolean;
  awaitingProjects: boolean;
  remembered: z.infer<typeof navigationSchema>;
  view: ProjectView;
  crossBoard: boolean;
  settings: boolean;
  selectProject: (
    workspaceId: string,
    projectId: string,
    view?: ProjectView,
    replace?: boolean,
  ) => void;
  selectWorkspace: (id: string) => void;
  openForm: (form: ShellForm) => void;
  openPalette: (mode?: PaletteMode) => void;
  /** Opens a task in its project's board, moving to that project first if needed. */
  openTask: (projectId: string, taskId: string, created?: boolean) => void;
  goBoard: () => void;
  selectBoardView: (view: 'board' | 'search') => void;
  goSettings: () => void;
  goProjectSettings: (project: Project) => void;
  goTrash: (project?: Project) => void;
};
export const ShellContext = createContext<ShellState | null>(null);
export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error('The page needs AppShell');
  return context;
}
