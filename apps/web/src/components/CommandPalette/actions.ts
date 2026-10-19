import type { Project, Status } from '@throw/shared';
import { type RefObject, useRef } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { useStatuses } from '@/lib/collections';
import { useAwaitingSync } from '@/lib/syncStatus';
import { createTask, type NewTask } from '@/lib/tasks';

export const MAX_TITLE = 500;

/**
 * Closes a panel inside the content (the scope or project list) before the surface holding
 * it closes, returning whether it did. The surface, not the content, owns Escape and Back.
 */
export type Dismiss = RefObject<(() => boolean) | null>;

export type PaletteActions = {
  openTask: (projectId: string, taskId: string, created?: boolean) => void;
  jump: (project: Project) => void;
  /**
   * Creates the task and opens it, or returns why it could not. Without a status it lands in
   * the backlog's default.
   */
  create: (
    projectId: string | undefined,
    title: string,
    fields?: Pick<NewTask, 'statusId' | 'priority' | 'primaryTagId' | 'secondaryTagIds'>,
  ) => string | null;
  statuses: Status[];
  awaitingStatuses: boolean;
};

/** Focuses the open surface's input; one leaving alongside it has disabled its own. */
export function focusPaletteInput() {
  document
    .querySelector<HTMLElement>('[data-palette-input]:not(:disabled)')
    ?.focus({ preventScroll: true });
}

export function backlogOf(statuses: readonly Status[], projectId: string | undefined) {
  return statuses.find((s) => s.projectId === projectId && s.category === 'backlog' && s.isDefault);
}

/** What search and capture do, taken once however many times they are chosen. */
export function usePaletteActions({
  onClose,
  onOpenTask,
  onAction,
}: {
  onClose: () => void;
  onOpenTask: (projectId: string, taskId: string, created?: boolean) => void;
  onAction: (destination: 'task' | 'project') => void;
}): PaletteActions {
  const shell = useShell();
  const taken = useRef(false);
  const { statuses, isLoading } = useStatuses();
  const awaitingStatuses = useAwaitingSync(isLoading, statuses.length);

  function openTask(projectId: string, taskId: string, created = false) {
    if (taken.current) return;
    taken.current = true;
    onAction('task');
    onClose();
    onOpenTask(projectId, taskId, created);
  }

  return {
    statuses,
    awaitingStatuses,
    openTask,
    jump(project) {
      if (taken.current) return;
      taken.current = true;
      onAction('project');
      onClose();
      shell.selectProject(project.workspaceId, project.id);
      document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    },
    create(projectId, title, fields = {}) {
      if (taken.current) return null;
      const trimmed = title.trim();
      if (!trimmed) return null;
      if (trimmed.length > MAX_TITLE) return 'Use 500 characters or fewer.';
      if (!projectId) return 'Choose a project.';
      if (!fields.statusId && !backlogOf(statuses, projectId))
        return awaitingStatuses
          ? 'Loading statuses…'
          : 'Connect to load this project’s backlog before capturing.';
      try {
        const taskId = createTask(projectId, { ...fields, title: trimmed });
        openTask(projectId, taskId, true);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not create the task. Try again.';
      }
    },
  };
}
