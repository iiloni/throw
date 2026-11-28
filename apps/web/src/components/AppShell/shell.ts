import type { Project, Workspace } from '@throw/shared';
import { createContext, useContext } from 'react';
import { z } from 'zod';
import type { PaletteMode } from '@/components/CommandPalette/CommandPalette';
import type { ShellForm } from '@/components/ShellForms/ShellForms';
import type { SettingsSection } from '@/lib/projectSettings';

export const viewSchema = z.enum(['backlog', 'board', 'search', 'graph']);
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
  /** A project board or the cross-project board fills the page. */
  board: boolean;
  settings: boolean;
  selectProject: (
    workspaceId: string,
    projectId: string,
    view?: ProjectView,
    replace?: boolean,
  ) => void;
  /**
   * Opens a workspace at the board it would open. `leaving` is a project just trashed, which
   * the shell has not seen go yet.
   */
  selectWorkspace: (id: string, leaving?: string) => void;
  openForm: (form: ShellForm) => void;
  /** The phone's project switcher, a drawer page (ADR 0009); null on a desktop. */
  switcher: { open: boolean; show: () => void } | null;
  /** The palette; `seed` starts capture with a title already written. */
  openPalette: (mode?: PaletteMode, seed?: string) => void;
  /** Search where it lives here: the bar over a desktop board, or the palette. */
  search: () => void;
  /** Opens a task in its project's board, moving to that project first if needed. */
  openTask: (projectId: string, taskId: string, created?: boolean) => void;
  goBoard: () => void;
  /**
   * Shows the board on screen as its columns or as the dependency graph, in place: the view
   * is in the address, so a reload or a link keeps it, and changing it adds no history.
   */
  showView: (view: 'board' | 'graph') => void;
  goSettings: () => void;
  /** A project's settings, at `section` when given. */
  goProjectSettings: (project: Project, section?: SettingsSection) => void;
  goTrash: (project?: Project) => void;
};
export const ShellContext = createContext<ShellState | null>(null);
export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error('The page needs AppShell');
  return context;
}
