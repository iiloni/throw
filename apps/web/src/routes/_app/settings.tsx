import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { McpSettingsContext, useMcpSettings } from '@/lib/mcpSettings';
import { useDesktop } from '@/lib/media';
import { settingsGroupsFor, settingsPageFor, useAdminAccess } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

function SettingsPage() {
  const pathname = useChildMatches({ select: (matches) => matches.at(-1)?.pathname ?? '' });
  const admin = useAdminAccess();
  const page = settingsPageFor(pathname);
  const mcp = useMcpSettings();
  const onMcpPage = page?.path === '/settings/mcp';
  const showMcp =
    mcp.state.status !== 'unavailable' && (mcp.state.status !== 'loading' || onMcpPage);
  // An admin page opened before the server confirms the role is not listed, so it is not shown
  // as the open one either.
  const current = (page?.section === 'Admin' && !admin) || (onMcpPage && !showMcp) ? null : page;
  return (
    <McpSettingsContext value={mcp}>
      <SettingsLayout
        title="Settings"
        groups={settingsGroupsFor(admin, showMcp)}
        current={current}
        wide={useDesktop()}
        roomy={current?.section === 'Admin'}
      >
        <Outlet />
      </SettingsLayout>
    </McpSettingsContext>
  );
}
