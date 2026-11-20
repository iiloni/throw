import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { McpSettingsContext } from '@/lib/mcpSettings';
import { McpTokens } from './McpTokens';

vi.mock('@/lib/api', () => ({ api: {} }));

test('shows the server requirement without offering token actions on an older server', () => {
  render(
    <McpSettingsContext
      value={{ state: { status: 'unavailable' }, retry: vi.fn(), added: vi.fn(), removed: vi.fn() }}
    >
      <McpTokens />
    </McpSettingsContext>,
  );
  expect(screen.getByText('MCP tokens require a newer Throw server')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Create token' })).not.toBeInTheDocument();
});
