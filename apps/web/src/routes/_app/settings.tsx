import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SettingsLayout } from '@/components/SettingsLayout/SettingsLayout';
import { useDesktop } from '@/lib/media';
import { settingsGroupsFor, settingsPageFor, useAdminAccess } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

function SettingsPage() {
  const pathname = useChildMatches({ select: (matches) => matches.at(-1)?.pathname ?? '' });
  const admin = useAdminAccess();
  const page = settingsPageFor(pathname);
  // An admin page opened before the server confirms the role is not listed, so it is not shown
  // as the open one either.
  const current = page?.section === 'Admin' && !admin ? null : page;
  return (
    <SettingsLayout
      title="Settings"
      groups={settingsGroupsFor(admin)}
      current={current}
      wide={useDesktop()}
      roomy={current?.section === 'Admin'}
    >
      <Outlet />
    </SettingsLayout>
  );
}
