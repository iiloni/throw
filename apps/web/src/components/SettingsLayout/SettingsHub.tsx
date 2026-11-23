import { linkOptions, useRouterState } from '@tanstack/react-router';
import type { Project } from '@throw/shared';
import type { ReactNode } from 'react';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import {
  SettingsLayout,
  type SettingsPage,
  type SettingsPageGroup,
} from '@/components/SettingsLayout/SettingsLayout';
import { McpSettingsContext, useMcpSettings } from '@/lib/mcpSettings';
import { useDesktop } from '@/lib/media';
import { settingsSectionSchema } from '@/lib/projectSettings';
import {
  projectSettingsPageKey,
  projectSettingsPages,
  settingsGroupsFor,
  settingsPageFor,
  useAdminAccess,
} from '@/lib/settings';
import { useWebhookSettings, WebhookSettingsContext } from '@/lib/webhookSettings';

/** A page whose API an older server lacks is listed once the server confirms it, or while open. */
const listed = (status: string, open: boolean) =>
  status !== 'unavailable' && (status !== 'loading' || open);

/**
 * The unified Settings hub around both `/settings/*` and `/w/:ws/p/:proj/settings` (and `/trash`).
 * Mounted once at the shell boundary so switching between project, user and admin pages keeps the
 * sidebar, its sliding selection indicator and API availability probes intact.
 */
export function SettingsHub({ project, children }: { project?: Project; children: ReactNode }) {
  const match = useRouterState({ select: (state) => state.matches.at(-1) });
  const pathname = match?.pathname ?? '';
  const routeId = match?.routeId;
  const admin = useAdminAccess();
  const mcp = useMcpSettings();
  const webhooks = useWebhookSettings();
  const wide = useDesktop();

  const appPage = settingsPageFor(pathname);
  const showMcp = listed(mcp.state.status, appPage?.path === '/settings/mcp');
  const showWebhooks = listed(webhooks.state.status, appPage?.path === '/settings/webhooks');
  // An admin page opened before the server confirms the role is not listed, so it is not shown
  // as the open one either.
  const appHidden =
    (appPage?.section === 'Admin' && !admin) ||
    (appPage?.path === '/settings/mcp' && !showMcp) ||
    (appPage?.path === '/settings/webhooks' && !showWebhooks);

  const projectPages = project ? projectSettingsPages(project) : [];
  const groups: SettingsPageGroup[] = [
    ...(project
      ? [
          {
            key: `project:${project.id}`,
            label: project.name,
            badge: (
              <span
                data-color={project.color}
                className="flex size-5 shrink-0 items-center justify-center rounded-md bg-tint text-tint-accent"
              >
                <ProjectIcon name={project.icon} className="size-3.5" />
              </span>
            ),
            pages: projectPages,
          },
        ]
      : []),
    ...settingsGroupsFor(admin, {
      '/settings/mcp': showMcp,
      '/settings/webhooks': showWebhooks,
    }),
  ];

  let current: SettingsPage | null = null;
  if (routeId === '/_app/w/$workspaceId/p/$projectId_/trash' && project) {
    const key = projectSettingsPageKey(project.id, 'trash');
    current = projectPages.find((page) => page.key === key) ?? null;
  } else if (routeId === '/_app/w/$workspaceId/p/$projectId_/settings' && project) {
    const rawSection =
      match?.search && typeof match.search === 'object' && 'section' in match.search
        ? match.search.section
        : undefined;
    const section = settingsSectionSchema.catch('general').parse(rawSection);
    const key = projectSettingsPageKey(project.id, section);
    current = projectPages.find((page) => page.key === key) ?? null;
  } else if (!appHidden) {
    current = appPage;
  }

  const back = project
    ? {
        label: 'Back to board',
        link: linkOptions({
          to: '/w/$workspaceId/p/$projectId',
          params: { workspaceId: project.workspaceId, projectId: project.id },
          search: { view: 'board' as const },
        }),
      }
    : undefined;

  return (
    <McpSettingsContext value={mcp}>
      <WebhookSettingsContext value={webhooks}>
        <SettingsLayout
          title="Settings"
          groups={groups}
          current={current}
          wide={wide}
          back={back}
          roomy={!appHidden && appPage?.section === 'Admin'}
        >
          {children}
        </SettingsLayout>
      </WebhookSettingsContext>
    </McpSettingsContext>
  );
}
