import { createFileRoute } from '@tanstack/react-router';
import { Webhooks } from '@/components/Webhooks/Webhooks';

export const Route = createFileRoute('/_app/settings/webhooks')({ component: Webhooks });
