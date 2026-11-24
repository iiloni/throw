import { fireEvent, render, screen } from '@testing-library/react';
import { Settings, UserRound } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { settingsDragY } from '@/lib/settingsSwipe';

const mocks = vi.hoisted(() => ({
  dock: null as ReactNode,
  navigate: vi.fn(),
  surfaceOpen: false,
  reducedMotion: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
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

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => mocks.reducedMotion,
}));

vi.mock('@/lib/haptics', () => ({
  haptics: {
    selection: vi.fn(),
    threshold: vi.fn(),
  },
}));

vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  useManagementDock: (node: ReactNode) => {
    mocks.dock = node;
  },
  useManagementSurfaceOpen: () => mocks.surfaceOpen,
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
const back = { label: 'Back to board', link: { to: '/' as const } };

function pull(element: HTMLElement, delta: number, cancel = false) {
  fireEvent.touchStart(element, { touches: [{ clientY: 200 }] });
  fireEvent.touchMove(element, { touches: [{ clientY: 200 + delta }] });
  // Rest before release so a short pull is not a fling.
  fireEvent.touchMove(element, { touches: [{ clientY: 200 + delta }] });
  if (cancel) fireEvent.touchCancel(element, { touches: [] });
  else fireEvent.touchEnd(element, { touches: [] });
}

beforeEach(() => {
  mocks.dock = null;
  mocks.surfaceOpen = false;
  mocks.reducedMotion = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.documentElement.scrollTop = 0;
  settingsDragY.stop();
  settingsDragY.set(0);
});

describe('SettingsLayout', () => {
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
    expect(mocks.dock).toBeNull();
  });

  it('names the open page in the phone dock, which lists the pages and closes on a pick', () => {
    render(
      <SettingsLayout
        title="Project settings"
        groups={groups}
        current={pages[0]!}
        wide={false}
        back={back}
      >
        <p>General content</p>
      </SettingsLayout>,
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    render(mocks.dock);
    fireEvent.click(screen.getByRole('button', { name: 'Project settings page: General' }));
    const picker = screen.getByRole('dialog', { name: 'Project settings' });
    expect(picker).toContainElement(screen.getByRole('link', { name: 'Back to board' }));
    // Opening a page in a new tab leaves the picker open on this one.
    fireEvent.click(screen.getByRole('link', { name: 'Account' }), { ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Project settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['down at the top', 0, 150, true],
    ['up at the bottom', 600, -150, true],
    ['down between edges', 300, 150, false],
    ['up between edges', 300, -150, false],
    ['up at the top', 0, -150, false],
    ['down at the bottom', 600, 150, false],
    ['a short pull', 0, 40, false],
  ])('uses the document scroll for %s', (_, scrollTop, delta, dismissed) => {
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(400);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000);
    document.documentElement.scrollTop = scrollTop;
    render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account content'), delta);
    expect(mocks.navigate).toHaveBeenCalledTimes(dismissed ? 1 : 0);
    if (dismissed) expect(mocks.navigate).toHaveBeenCalledWith(back.link);
    expect(haptics.threshold).toHaveBeenCalledTimes(dismissed ? 1 : 0);
  });

  it('keeps settings open when a pull is canceled', () => {
    render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account content'), 150, true);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not swipe away the wide layout', () => {
    render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account content'), 150);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(haptics.threshold).not.toHaveBeenCalled();
  });

  it('does not swipe away when no back link is available', () => {
    render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account content'), 150);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(haptics.threshold).not.toHaveBeenCalled();
  });

  it('ignores gestures while a ManagementSurface drawer or dialog is open on top', () => {
    mocks.surfaceOpen = true;
    const { rerender } = render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pull(screen.getByText('Account content'), 150);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(settingsDragY.get()).toBe(0);

    // Also blocks gestures when a standalone dialog is mounted over settings.
    mocks.surfaceOpen = false;
    rerender(
      <>
        <SettingsLayout
          title="Settings"
          groups={groups}
          current={pages[1]!}
          wide={false}
          back={back}
        >
          <p>Account content</p>
        </SettingsLayout>
        <div role="dialog" aria-label="Confirmation" />
      </>,
    );
    pull(screen.getByText('Account content'), 150);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(settingsDragY.get()).toBe(0);
  });

  it('clears the shared offset on unmount, page changes, and layout switches', () => {
    const { rerender, unmount } = render(
      <SettingsLayout title="Settings" groups={groups} current={pages[0]!} wide={false} back={back}>
        <p>General content</p>
      </SettingsLayout>,
    );
    const pullPartial = (text: string) => {
      const page = screen.getByText(text);
      fireEvent.touchStart(page, { touches: [{ clientY: 200 }] });
      fireEvent.touchMove(page, { touches: [{ clientY: 350 }] });
      expect(settingsDragY.get()).toBeGreaterThan(0);
    };

    pullPartial('General content');
    rerender(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    expect(settingsDragY.get()).toBe(0);

    pullPartial('Account content');
    rerender(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    expect(settingsDragY.get()).toBe(0);

    rerender(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    pullPartial('Account content');
    unmount();
    expect(settingsDragY.get()).toBe(0);
  });

  it('keeps content untransformed under reduced motion while still dismissing on pull', () => {
    mocks.reducedMotion = true;
    render(
      <SettingsLayout title="Settings" groups={groups} current={pages[1]!} wide={false} back={back}>
        <p>Account content</p>
      </SettingsLayout>,
    );
    const page = screen.getByText('Account content');
    const content = document.querySelector<HTMLElement>('[data-settings-content]')!;
    fireEvent.touchStart(page, { touches: [{ clientY: 200 }] });
    fireEvent.touchMove(page, { touches: [{ clientY: 350 }] });
    expect(settingsDragY.get()).toBeGreaterThan(0);
    expect(content.style.transform).toBe('none');
    fireEvent.touchEnd(page, { touches: [] });
    expect(mocks.navigate).toHaveBeenCalledWith(back.link);
  });
});
