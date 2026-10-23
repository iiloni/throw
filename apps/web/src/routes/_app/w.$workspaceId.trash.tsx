import { createFileRoute } from '@tanstack/react-router';
import { Trash } from '@/components/Trash/Trash';
export const Route = createFileRoute('/_app/w/$workspaceId/trash')({ component: Trash });
