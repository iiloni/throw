import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { useDesktop } from '@/lib/media';
import { settingsGroupsFor, settingsPageFor, useAdminAccess } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

function SettingsPage() {
  const pathname = useChildMatches({ select: (matches) => matches.at(-1)?.pathname ?? '' });
  const current = settingsPageFor(pathname);
  return (
    <SettingsLayout
      title="Settings"
      groups={settingsGroupsFor(useAdminAccess())}
      current={current}
      wide={useDesktop()}
      roomy={current?.section === 'Admin'}
    >
      <Outlet />
    </SettingsLayout>
  );
}
