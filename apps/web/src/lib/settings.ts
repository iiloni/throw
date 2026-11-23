import { linkOptions } from '@tanstack/react-router';
import type { Project } from '@throw/shared';
import {
  ArrowUpDown,
  CircleUser,
  Columns3,
  DatabaseBackup,
  Download,
  KeyRound,
  type LucideIcon,
  SlidersHorizontal,
  Tags,
  Trash2,
  Webhook,
} from 'lucide-react';
import { z } from 'zod';
import { authClient } from './auth';
import { type SettingsSection as ProjectSection, settingsSectionSchema } from './projectSettings';

/**
 * The pages of Settings, in the order they are listed, as Catch lists its own. Each has a
 * route file under `routes/_app/settings/`.
 */
export const SETTINGS_TABS = [
  { path: '/settings/general', label: 'General', icon: SlidersHorizontal, section: 'User' },
  { path: '/settings/account', label: 'Account', icon: CircleUser, section: 'User' },
  { path: '/settings/mcp', label: 'MCP tokens', icon: KeyRound, section: 'User' },
  { path: '/settings/webhooks', label: 'Webhooks', icon: Webhook, section: 'User' },
  { path: '/settings/update', label: 'Update', icon: Download, section: 'User' },
  { path: '/settings/admin/backups', label: 'Backups', icon: DatabaseBackup, section: 'Admin' },
] as const satisfies ReadonlyArray<{
  path: string;
  label: string;
  icon: LucideIcon;
  section: 'User' | 'Admin';
}>;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsPath = SettingsTab['path'];

const PROJECT_PAGES = {
  general: { label: 'General', icon: SlidersHorizontal },
  statuses: { label: 'Statuses', icon: Columns3 },
  priorities: { label: 'Priorities', icon: ArrowUpDown },
  tags: { label: 'Tags', icon: Tags },
} as const satisfies Record<ProjectSection, { label: string; icon: LucideIcon }>;

export type ProjectSettingsPage = ProjectSection | 'trash';

export function projectSettingsPageKey(projectId: string, page: ProjectSettingsPage) {
  return `project:${projectId}:${page}`;
}

/** A project's pages in the unified settings list, in the order they appear. */
export function projectSettingsPages(project: Project) {
  const params = { workspaceId: project.workspaceId, projectId: project.id };
  return [
    ...settingsSectionSchema.options.map((section) => ({
      key: projectSettingsPageKey(project.id, section),
      ...PROJECT_PAGES[section],
      link: linkOptions({
        to: '/w/$workspaceId/p/$projectId/settings',
        params,
        search: section === 'general' ? {} : { section },
      }),
    })),
    {
      key: projectSettingsPageKey(project.id, 'trash'),
      label: 'Trash',
      icon: Trash2,
      link: linkOptions({ to: '/w/$workspaceId/p/$projectId/trash', params }),
    },
  ];
}

const pageOf = (tab: SettingsTab) => ({ ...tab, key: tab.path, link: { to: tab.path } });

/** Pages listed only once the server answers that it has their API. */
export type OptionalSettingsPath = '/settings/mcp' | '/settings/webhooks';

/** The pages this account can open, grouped as the settings list shows them. */
export function settingsGroupsFor(
  isAdmin: boolean,
  available: Partial<Record<OptionalSettingsPath, boolean>> = {},
) {
  const optional = (path: string): path is OptionalSettingsPath =>
    path === '/settings/mcp' || path === '/settings/webhooks';
  return (['User', 'Admin'] as const)
    .filter((section) => section === 'User' || isAdmin)
    .map((label) => ({
      key: label.toLowerCase(),
      label,
      pages: SETTINGS_TABS.filter(
        (tab) => tab.section === label && (!optional(tab.path) || available[tab.path] === true),
      ).map(pageOf),
    }));
}

export function settingsTabFor(pathname: string): SettingsTab | null {
  return SETTINGS_TABS.find((tab) => tab.path === pathname) ?? null;
}

export function settingsPageFor(pathname: string) {
  const tab = settingsTabFor(pathname);
  return tab ? pageOf(tab) : null;
}

const adminUserSchema = z.object({ role: z.literal('admin') });

export function hasAdminRole(user: unknown) {
  return adminUserSchema.safeParse(user).success;
}

/**
 * Whether the server says this account is its admin: false until it answers. A failed
 * refetch keeps the session it last had, so the admin's pages stay listed through it.
 */
export function useAdminAccess() {
  const { data } = authClient.useSession();
  return hasAdminRole(data?.user);
}
