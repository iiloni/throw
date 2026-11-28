import type { AdminUser, UserRole, UsersResponse } from '@throw/shared';
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { AdminRequestError, adminApi, formatDay, formatMoment } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { nameOf, type UserAction, UserActionSurface } from './UserActionSurface';

export const USERS_PAGE_SIZE = 25;

type Props = {
  /** The signed-in admin, who manages their own account in Account settings instead. */
  currentUserId: string;
  onAccessDenied: () => void;
};

type Query = {
  search: string;
  offset: number /** Bumped to fetch the same page again. */;
  load: number;
};

/** Every account on the server, for its admins (ADR 0018). */
export function UserManagement({ currentUserId, onAccessDenied }: Props) {
  const [query, setQuery] = useState<Query>({ search: '', offset: 0, load: 0 });
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [action, setAction] = useState<UserAction | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    // Typing waits for a pause, so each key does not ask the server again.
    const timer = window.setTimeout(
      () => {
        void adminApi
          .users(
            { search: query.search.trim(), offset: query.offset, limit: USERS_PAGE_SIZE },
            abort.signal,
          )
          .then(
            (result) => {
              if (abort.signal.aborted) return;
              setData(result);
              setFailed(false);
              setLoading(false);
            },
            (error: unknown) => {
              if (abort.signal.aborted) return;
              if (error instanceof AdminRequestError && error.accessDenied) {
                onAccessDenied();
                return;
              }
              setFailed(true);
              setLoading(false);
            },
          );
      },
      query.search ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [query, onAccessDenied]);

  const reload = () => setQuery((current) => ({ ...current, load: current.load + 1 }));

  function changed(updated: AdminUser) {
    setData(
      (current) =>
        current && {
          ...current,
          users: current.users.map((row) => (row.id === updated.id ? updated : row)),
        },
    );
  }

  function deleted(user: AdminUser) {
    toast.success(`${nameOf(user)} was deleted`);
    setQuery((current) => ({
      ...current,
      // The last account on a later page leaves that page empty: show the one before it.
      offset:
        data?.users.length === 1 ? Math.max(0, current.offset - USERS_PAGE_SIZE) : current.offset,
      load: current.load + 1,
    }));
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const page = Math.floor(query.offset / USERS_PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search users"
          placeholder="Search by name or email"
          maxLength={200}
          value={query.search}
          onChange={(event) => setQuery({ search: event.target.value, offset: 0, load: 0 })}
          className="h-11 rounded-xl pl-10"
        />
      </div>
      <SettingsSection
        title="Server accounts"
        description="Admins can manage every account, invite people and restore backups. Change your own password in Account settings."
        action={
          <IconButton
            label="Refresh users"
            className="size-11 sm:size-8"
            disabled={loading}
            onClick={reload}
          >
            <RefreshCw className={cn(loading && data && 'animate-spin')} />
          </IconButton>
        }
      >
        {data === null ? (
          failed ? (
            <div className="flex min-h-14 items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Could not load users</p>
                <p className="text-muted-foreground text-sm">
                  Check your connection and try again.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={reload}>
                Retry
              </Button>
            </div>
          ) : (
            <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
              Loading users…
            </p>
          )
        ) : data.users.length === 0 ? (
          <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
            {query.search.trim() ? 'No accounts match this search.' : 'No accounts on this page.'}
          </p>
        ) : (
          <ul aria-label="Users" className="flex flex-col divide-y divide-foreground/[0.06]">
            {data.users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                self={user.id === currentUserId}
                onAction={setAction}
              />
            ))}
          </ul>
        )}
      </SettingsSection>
      {data && failed && (
        <p role="alert" className="px-4 text-destructive text-sm">
          Could not refresh the list. Check your connection and try again.
        </p>
      )}
      {data && (pages > 1 || query.offset > 0) && (
        <nav aria-label="Users pages" className="flex items-center justify-between gap-2 px-1">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 rounded-full"
            disabled={query.offset === 0 || loading}
            onClick={() =>
              setQuery((current) => ({
                ...current,
                offset: Math.max(0, current.offset - USERS_PAGE_SIZE),
              }))
            }
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {page} of {pages}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 rounded-full"
            disabled={query.offset + USERS_PAGE_SIZE >= total || loading}
            onClick={() =>
              setQuery((current) => ({ ...current, offset: current.offset + USERS_PAGE_SIZE }))
            }
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      )}
      <UserActionSurface
        action={action}
        onClose={() => setAction(null)}
        onChanged={changed}
        onDeleted={deleted}
        onAccessDenied={onAccessDenied}
      />
    </div>
  );
}

const ROLE_NAMES: Record<UserRole, string> = { admin: 'Admin', user: 'User' };

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 font-medium text-xs',
        role === 'admin'
          ? 'bg-accent text-accent-foreground'
          : 'bg-foreground/[0.07] text-muted-foreground',
      )}
    >
      {ROLE_NAMES[role]}
    </span>
  );
}

function LastLogin({ value }: { value: string | null }) {
  if (!value)
    return (
      <span>
        <span aria-hidden>—</span>
        <span className="sr-only">never</span>
      </span>
    );
  return <time dateTime={value}>{formatMoment(value)}</time>;
}

function UserRow({
  user,
  self,
  onAction,
}: {
  user: AdminUser;
  self: boolean;
  onAction: (action: UserAction) => void;
}) {
  return (
    <li aria-label={user.email} className="flex min-h-14 items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{user.name || 'Unnamed user'}</span>
          {self && <span className="shrink-0 text-muted-foreground text-xs">You</span>}
        </p>
        <p className="truncate text-muted-foreground text-sm">{user.email}</p>
        <p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
          <span>
            Joined <time dateTime={user.createdAt}>{formatDay(user.createdAt)}</time>
          </span>
          <span>
            Last sign-in <LastLogin value={user.lastLoginAt} />
          </span>
        </p>
      </div>
      <RoleBadge role={user.role} />
      {/* An admin's own role, password and account are not theirs to change here. */}
      {self ? (
        <span className="size-11 shrink-0 sm:size-8" aria-hidden />
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Manage ${user.email}`} className="size-11 shrink-0 sm:size-8">
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                onAction({ kind: 'role', user, role: user.role === 'admin' ? 'user' : 'admin' })
              }
            >
              {user.role === 'admin' ? <ShieldOff /> : <ShieldCheck />}
              {user.role === 'admin' ? 'Remove admin access' : 'Make admin'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ kind: 'reset', user })}>
              <KeyRound />
              Reset password
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onAction({ kind: 'delete', user })}
            >
              <Trash2 />
              Delete user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
