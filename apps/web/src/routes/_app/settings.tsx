import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { McpSettingsContext, useMcpSettings } from '@/lib/mcpSettings';
import { useDesktop } from '@/lib/media';
import { settingsGroupsFor, settingsPageFor, useAdminAccess } from '@/lib/settings';
import { useWebhookSettings, WebhookSettingsContext } from '@/lib/webhookSettings';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

/** A page whose API an older server lacks is listed once the server confirms it, or while open. */
const listed = (status: string, open: boolean) =>
  status !== 'unavailable' && (status !== 'loading' || open);

function SettingsPage() {
  const pathname = useChildMatches({ select: (matches) => matches.at(-1)?.pathname ?? '' });
  const admin = useAdminAccess();
  const page = settingsPageFor(pathname);
  const mcp = useMcpSettings();
  const webhooks = useWebhookSettings();
  const showMcp = listed(mcp.state.status, page?.path === '/settings/mcp');
  const showWebhooks = listed(webhooks.state.status, page?.path === '/settings/webhooks');
  // An admin page opened before the server confirms the role is not listed, so it is not shown
  // as the open one either.
  const hidden =
    (page?.section === 'Admin' && !admin) ||
    (page?.path === '/settings/mcp' && !showMcp) ||
    (page?.path === '/settings/webhooks' && !showWebhooks);
  const current = hidden ? null : page;
  return (
    <McpSettingsContext value={mcp}>
      <WebhookSettingsContext value={webhooks}>
        <SettingsLayout
          title="Settings"
          groups={settingsGroupsFor(admin, {
            '/settings/mcp': showMcp,
            '/settings/webhooks': showWebhooks,
          })}
          current={current}
          wide={useDesktop()}
          roomy={current?.section === 'Admin'}
        >
          <Outlet />
        </SettingsLayout>
      </WebhookSettingsContext>
    </McpSettingsContext>
  );
}
