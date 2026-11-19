import { Link, type LinkOptions } from '@tanstack/react-router';
import { ChevronLeft, ChevronUp, type LucideIcon, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useMemo, useState } from 'react';
import {
  ManagementSurface,
  useManagementDock,
} from '@/components/ManagementSurface/ManagementSurface';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** A page and where it is: route options, so a renamed route fails the typecheck. */
export type SettingsPage = { key: string; label: string; icon: LucideIcon; link: LinkOptions };
export type SettingsPageGroup = { label: string; pages: readonly SettingsPage[] };

type Props = {
  /** What the pages belong to, naming the phone's page list. */
  title: string;
  groups: readonly SettingsPageGroup[];
  /** The open page. */
  current: SettingsPage | null;
  /** Lists the pages beside the open one; otherwise the dock picks between them. */
  wide: boolean;
  /** Where leaving these settings goes, listed above the pages. */
  back?: { label: string; link: LinkOptions };
  /** A page with wide content, such as a table, takes more of the window. */
  roomy?: boolean;
  children: ReactNode;
};

/**
 * A settings frame around its open page, after Catch's. Wide, the pages are listed in a column
 * beside it. Narrow, the page fills the screen under its own title and the phone's dock picks
 * between the pages. App settings and project settings share it.
 */
export function SettingsLayout({
  title,
  groups,
  current,
  wide,
  back,
  roomy = false,
  children,
}: Props) {
  const heading = current && (
    <h2 className="px-1 font-display font-bold text-2xl tracking-[-0.02em]">{current.label}</h2>
  );
  if (!wide) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-3 sm:px-6">
        {heading}
        {children}
        <SettingsDock title={title} groups={groups} current={current} back={back} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'grid gap-8 px-8',
        roomy ? 'grid-cols-[14rem_minmax(0,48rem)]' : 'grid-cols-[14rem_minmax(0,42rem)]',
      )}
    >
      <nav aria-label={`${title} pages`} className="sticky top-8 flex flex-col gap-6 self-start">
        {back && <BackLink {...back} />}
        <PageList groups={groups} current={current} indicator="settings-nav" />
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        {heading}
        {children}
      </div>
    </div>
  );
}

/** A link that moves within settings without adding to history, so Back leaves in one step. */
function PageLink({
  link,
  replace = true,
  className,
  onNavigate,
  children,
  ...props
}: {
  link: LinkOptions;
  replace?: boolean;
  className?: string;
  onNavigate?: () => void;
  children: ReactNode;
  'aria-current'?: 'page';
}) {
  return (
    <Link
      {...link}
      {...props}
      replace={replace}
      // Selection is drawn from the open page, not the router's idea of an active link.
      activeOptions={{ exact: true, includeSearch: true }}
      className={className}
      onClick={() => onNavigate?.()}
    >
      {children}
    </Link>
  );
}

function BackLink({
  label,
  link,
  onNavigate,
}: {
  label: string;
  link: LinkOptions;
  onNavigate?: () => void;
}) {
  return (
    <PageLink
      link={link}
      replace={false}
      onNavigate={onNavigate}
      className="-ml-1 flex h-10 items-center gap-1 self-start rounded-full pr-3 pl-1 font-medium text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
    >
      <ChevronLeft className="size-5" aria-hidden />
      {label}
    </PageLink>
  );
}

function PageList({
  groups,
  current,
  indicator,
  onNavigate,
}: {
  groups: readonly SettingsPageGroup[];
  current: SettingsPage | null;
  /** The shared layout id of the selection, so it slides between pages. */
  indicator: string;
  onNavigate?: () => void;
}) {
  return groups.map((group) => (
    <section key={group.label} aria-label={group.label} className="flex flex-col gap-1">
      <h3 className="px-3 pb-1 font-medium text-muted-foreground text-sm">{group.label}</h3>
      {group.pages.map((page) => {
        const Icon = page.icon;
        const selected = current?.key === page.key;
        return (
          <PageLink
            key={page.key}
            link={page.link}
            aria-current={selected ? 'page' : undefined}
            onNavigate={() => {
              if (!selected) haptics.selection();
              onNavigate?.();
            }}
            className={cn(
              'relative z-0 flex h-11 items-center gap-3 rounded-xl px-3 font-medium outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/60',
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId={indicator}
                aria-hidden
                className="-z-10 absolute inset-0 rounded-xl bg-foreground/[0.08]"
                transition={springs.snappy}
              />
            )}
            <Icon className="size-5" aria-hidden />
            {page.label}
          </PageLink>
        );
      })}
    </section>
  ));
}

/**
 * The phone's dock in settings: the open page's name, which lists the pages in the drawer to
 * pick another, as Catch's dock picks its Settings pages.
 */
function SettingsDock({
  title,
  groups,
  current,
  back,
}: {
  title: string;
  groups: readonly SettingsPageGroup[];
  current: SettingsPage | null;
  back?: { label: string; link: LinkOptions };
}) {
  const [picking, setPicking] = useState(false);
  const Icon = current?.icon ?? Settings;
  const label = current?.label ?? title;
  const dock = useMemo(
    () => (
      <motion.button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${title} page: ${label}`}
        onClick={() => setPicking(true)}
        whileTap={{ scale: 0.97 }}
        transition={springs.snappy}
        className="flex h-[var(--dock-height)] w-full min-w-0 items-center gap-3 rounded-[var(--dock-radius)] bg-foreground/[0.06] px-4 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronUp aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </motion.button>
    ),
    [Icon, label, title],
  );
  useManagementDock(dock);
  return (
    <ManagementSurface open={picking} title={title} fit onClose={() => setPicking(false)}>
      <nav aria-label={`${title} pages`} className="flex flex-col gap-4 pb-1">
        {back && <BackLink {...back} onNavigate={() => setPicking(false)} />}
        <PageList
          groups={groups}
          current={current}
          indicator="settings-dock-nav"
          onNavigate={() => setPicking(false)}
        />
      </nav>
    </ManagementSurface>
  );
}
