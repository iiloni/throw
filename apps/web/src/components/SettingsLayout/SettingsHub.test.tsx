import { render, screen, within } from '@testing-library/react';
import type { Project } from '@throw/shared';
import type { MouseEvent, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const routerState = vi.hoisted(() => ({
  match: {
    routeId: '/_app/settings/general',
    pathname: '/settings/general',
    search: {} as Record<string, unknown>,
  },
}));
const access = vi.hoisted(() => ({
  admin: false,
  desktop: true,
  mcpStatus: 'ready' as 'loading' | 'ready' | 'unavailable' | 'error',
  webhooksStatus: 'ready' as 'loading' | 'ready' | 'unavailable' | 'error',
}));

vi.mock('@tanstack/react-router', () => ({
  linkOptions: <T,>(options: T) => options,
  useRouterState: ({ select }: { select: (state: { matches: unknown[] }) => unknown }) =>
    select({ matches: [routerState.match] }),
  Link: ({
    children,
    to,
    onClick,
    replace,
    activeOptions: _activeOptions,
    params: _params,
    search: _search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    onClick?: (event: MouseEvent) => void;
    replace?: boolean;
    activeOptions?: unknown;
    params?: unknown;
    search?: unknown;
    'aria-current'?: 'page';
    className?: string;
  }) => (
    <a href={to} data-replace={String(replace)} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/media', () => ({ useDesktop: () => access.desktop }));
vi.mock('@/lib/mcpSettings', async (actual) => ({
  ...(await actual<typeof import('@/lib/mcpSettings')>()),
  useMcpSettings: () => ({
    state:
      access.mcpStatus === 'ready'
        ? { status: 'ready', inventory: { tokens: [] } }
        : { status: access.mcpStatus },
    retry: vi.fn(),
    added: vi.fn(),
    removed: vi.fn(),
  }),
}));
vi.mock('@/lib/webhookSettings', async (actual) => ({
  ...(await actual<typeof import('@/lib/webhookSettings')>()),
  useWebhookSettings: () => ({
    state:
      access.webhooksStatus === 'ready'
        ? { status: 'ready', inventory: { webhooks: [] } }
        : { status: access.webhooksStatus },
    retry: vi.fn(),
    added: vi.fn(),
    replaced: vi.fn(),
    removed: vi.fn(),
  }),
}));
vi.mock('@/lib/settings', async (actual) => ({
  ...(await actual<typeof import('@/lib/settings')>()),
  useAdminAccess: () => access.admin,
}));

import { SettingsHub } from './SettingsHub';

const project: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Kitchen',
  key: 'KIT',
  color: 'teal',
  icon: 'house',
  position: 'a0',
  deletedAt: null,
  priorityNames: ['', '', '', '', ''],
};

beforeEach(() => {
  routerState.match = {
    routeId: '/_app/settings/general',
    pathname: '/settings/general',
    search: {},
  };
  access.admin = false;
  access.desktop = true;
  access.mcpStatus = 'ready';
  access.webhooksStatus = 'ready';
});

it('shows project pages beside User and Admin sections and Back to board when a project is active', () => {
  access.admin = true;
  render(
    <SettingsHub project={project}>
      <p>Body</p>
    </SettingsHub>,
  );
  const nav = screen.getByRole('navigation', { name: 'Settings pages' });
  expect(within(nav).getByRole('link', { name: 'Back to board' })).toBeInTheDocument();

  const projectGroup = within(nav).getByRole('region', { name: 'Kitchen' });
  for (const label of ['General', 'Statuses', 'Priorities', 'Tags', 'Trash']) {
    expect(within(projectGroup).getByRole('link', { name: label })).toBeInTheDocument();
  }
  expect(within(projectGroup).getByRole('link', { name: 'General' })).not.toHaveAttribute(
    'aria-current',
  );

  const userGroup = within(nav).getByRole('region', { name: 'User' });
  expect(within(userGroup).getByRole('link', { name: 'General' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(userGroup).getByRole('link', { name: 'MCP tokens' })).toBeInTheDocument();
  expect(within(userGroup).getByRole('link', { name: 'Webhooks' })).toBeInTheDocument();

  const adminGroup = within(nav).getByRole('region', { name: 'Admin' });
  expect(within(adminGroup).getByRole('link', { name: 'Backups' })).toBeInTheDocument();
});

it('highlights the open project settings section and trash route cleanly', () => {
  routerState.match = {
    routeId: '/_app/w/$workspaceId/p/$projectId_/settings',
    pathname: '/w/ws-1/p/proj-1/settings',
    search: { section: 'statuses' },
  };
  const { rerender } = render(
    <SettingsHub project={project}>
      <p>Statuses body</p>
    </SettingsHub>,
  );
  const nav = screen.getByRole('navigation', { name: 'Settings pages' });
  const projectGroup = within(nav).getByRole('region', { name: 'Kitchen' });
  expect(within(projectGroup).getByRole('link', { name: 'Statuses' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('heading', { name: 'Statuses' })).toBeInTheDocument();

  routerState.match = {
    routeId: '/_app/w/$workspaceId/p/$projectId_/trash',
    pathname: '/w/ws-1/p/proj-1/trash',
    search: {},
  };
  rerender(
    <SettingsHub project={project}>
      <p>Trash body</p>
    </SettingsHub>,
  );
  expect(within(projectGroup).getByRole('link', { name: 'Trash' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('heading', { name: 'Trash' })).toBeInTheDocument();
});

it('omits the project section and Back to board gracefully when no project exists', () => {
  render(
    <SettingsHub>
      <p>Body</p>
    </SettingsHub>,
  );
  const nav = screen.getByRole('navigation', { name: 'Settings pages' });
  expect(within(nav).queryByRole('link', { name: 'Back to board' })).not.toBeInTheDocument();
  expect(within(nav).getByRole('region', { name: 'User' })).toBeInTheDocument();
  expect(within(nav).queryByRole('region', { name: 'Kitchen' })).not.toBeInTheDocument();
});
