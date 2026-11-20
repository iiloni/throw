import { createFileRoute } from '@tanstack/react-router';
import { McpTokens } from '@/components/McpTokens/McpTokens';

export const Route = createFileRoute('/_app/settings/mcp')({ component: McpTokens });
