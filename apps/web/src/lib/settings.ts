import {
  CircleUser,
  DatabaseBackup,
  Download,
  KeyRound,
  type LucideIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { z } from 'zod';
import { authClient } from './auth';

/**
 * The pages of Settings, in the order they are listed, as Catch lists its own. Each has a
 * route file under `routes/_app/settings/`.
 */
export const SETTINGS_TABS = [
  { path: '/settings/general', label: 'General', icon: SlidersHorizontal, section: 'User' },
  { path: '/settings/account', label: 'Account', icon: CircleUser, section: 'User' },
  { path: '/settings/mcp', label: 'MCP tokens', icon: KeyRound, section: 'User' },
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

const pageOf = (tab: SettingsTab) => ({ ...tab, key: tab.path, link: { to: tab.path } });

/** The pages this account can open, grouped as the settings list shows them. */
export function settingsGroupsFor(isAdmin: boolean, mcpAvailable = false) {
  return (['User', 'Admin'] as const)
    .filter((section) => section === 'User' || isAdmin)
    .map((label) => ({
      label,
      pages: SETTINGS_TABS.filter(
        (tab) => tab.section === label && (tab.path !== '/settings/mcp' || mcpAvailable),
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
