import { fireEvent, render, screen } from '@testing-library/react';
import { Settings, UserRound } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const dock = vi.hoisted(() => ({ current: null as ReactNode }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    onClick,
    replace,
    activeOptions: _activeOptions,
    ...props
  }: {
    children: ReactNode;
    to: string;
    onClick?: (event: MouseEvent) => void;
    replace?: boolean;
    activeOptions?: unknown;
    'aria-current'?: 'page';
    className?: string;
  }) => (
    <a href={to} data-replace={String(replace)} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  useManagementDock: (node: ReactNode) => {
    dock.current = node;
  },
  ManagementSurface: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open && (
      <section role="dialog" aria-label={title}>
        {children}
      </section>
    ),
}));

import { SettingsLayout, type SettingsPage } from './SettingsLayout';

const pages: SettingsPage[] = [
  { key: 'general', label: 'General', icon: Settings, link: { to: '/settings/general' } },
  { key: 'account', label: 'Account', icon: UserRound, link: { to: '/settings/account' } },
];
const groups = [{ label: 'User', pages }];

beforeEach(() => {
  dock.current = null;
});

it('lists the pages beside the open one on wide screens, switching without history', () => {
  render(
    <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide>
      <p>Account content</p>
    </SettingsLayout>,
  );
  const nav = screen.getByRole('navigation', { name: 'Settings pages' });
  expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible();
  const account = screen.getByRole('link', { name: 'Account' });
  expect(account).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('data-replace', 'true');
  expect(nav).toContainElement(account);
  expect(dock.current).toBeNull();
});

it('names the open page in the phone dock, which lists the pages and closes on a pick', () => {
  render(
    <SettingsLayout
      title="Project settings"
      groups={groups}
      current={pages[0]!}
      wide={false}
      back={{ label: 'Back to board', link: { to: '/' } }}
    >
      <p>General content</p>
    </SettingsLayout>,
  );
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  render(<>{dock.current}</>);
  fireEvent.click(screen.getByRole('button', { name: 'Project settings page: General' }));
  const picker = screen.getByRole('dialog', { name: 'Project settings' });
  expect(picker).toContainElement(screen.getByRole('link', { name: 'Back to board' }));
  // Opening a page in a new tab leaves the picker open on this one.
  fireEvent.click(screen.getByRole('link', { name: 'Account' }), { ctrlKey: true });
  expect(screen.getByRole('dialog', { name: 'Project settings' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Account' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
