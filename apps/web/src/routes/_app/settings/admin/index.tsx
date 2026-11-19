import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/settings/admin/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/admin/backups', replace: true });
  },
});
