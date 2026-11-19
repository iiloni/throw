import { createFileRoute } from '@tanstack/react-router';
import { AccountSettings } from '@/components/AccountSettings/AccountSettings';

export const Route = createFileRoute('/_app/settings/account')({ component: AccountSettings });
