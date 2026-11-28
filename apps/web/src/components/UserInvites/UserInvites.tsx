import { INVITE_DAYS, type Invite, inviteLink } from '@throw/shared';
import { Copy, Link2, Plus, Share2, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminRequestError, adminApi, formatDay } from '@/lib/admin';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { cn } from '@/lib/utils';

type Props = { onAccessDenied: () => void };

export type InviteState = 'usable' | 'used' | 'expired';

export function inviteState(invite: Invite, now: number): InviteState {
  if (invite.usedAt) return 'used';
  return new Date(invite.expiresAt).getTime() <= now ? 'expired' : 'usable';
}

function describe(invite: Invite, state: InviteState) {
  if (state === 'used')
    return `Used ${formatDay(invite.usedAt ?? invite.createdAt)}${invite.usedBy ? ` by ${invite.usedBy.email}` : ''}`;
  if (state === 'expired') return `Expired ${formatDay(invite.expiresAt)}`;
  return `Usable until ${formatDay(invite.expiresAt)}`;
}

const STATE_NAMES: Record<InviteState, string> = {
  usable: 'Usable',
  used: 'Used',
  expired: 'Expired',
};

type Load =
  | { status: 'loading' | 'error' | 'unavailable' }
  | { status: 'ready'; invites: Invite[] };

/** Links that each let one person make an account on this server (ADR 0018). */
export function UserInvites({ onAccessDenied }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // An invite that runs out while the page is open should stop reading as usable.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const denied = useCallback(
    (failure: unknown) => {
      if (!(failure instanceof AdminRequestError && failure.accessDenied)) return false;
      onAccessDenied();
      return true;
    },
    [onAccessDenied],
  );

  useEffect(() => {
    if (load.status !== 'loading') return;
    const abort = new AbortController();
    adminApi.invites(abort.signal).then(
      ({ invites }) => {
        if (!abort.signal.aborted) setLoad({ status: 'ready', invites });
      },
      (failure: unknown) => {
        if (abort.signal.aborted || denied(failure)) return;
        // A server from before invites has no such route.
        setLoad({
          status:
            failure instanceof AdminRequestError && failure.status === 404
              ? 'unavailable'
              : 'error',
        });
      },
    );
    return () => abort.abort();
  }, [load.status, denied]);

  async function remove(invite: Invite) {
    setError('');
    try {
      await adminApi.deleteInvite(invite.id);
      haptics.selection();
      setLoad((current) =>
        current.status === 'ready'
          ? { ...current, invites: current.invites.filter((row) => row.id !== invite.id) }
          : current,
      );
    } catch (failure) {
      if (!denied(failure)) setError('Could not remove the invite. Try again.');
    }
  }

  if (load.status === 'unavailable') return null;
  return (
    <div className="flex flex-col gap-2">
      <SettingsSection
        title="Invites"
        description={`Each link lets one person make an account within ${INVITE_DAYS} days. Removing a link that is still usable revokes it; accounts made with one stay.`}
      >
        {load.status === 'loading' && (
          <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
            Loading invites…
          </p>
        )}
        {load.status === 'error' && (
          <SettingsRow
            label="Could not load invites"
            description="Check your connection and try again."
          >
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLoad({ status: 'loading' })}
            >
              Retry
            </Button>
          </SettingsRow>
        )}
        {load.status === 'ready' && (
          <>
            {load.invites.length === 0 && <SettingsRow label="No invites" />}
            {load.invites.length > 0 && (
              <ul aria-label="Invites" className="flex flex-col divide-y divide-foreground/[0.06]">
                {load.invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    state={inviteState(invite, now)}
                    onRemove={() => void remove(invite)}
                  />
                ))}
              </ul>
            )}
            <div className="px-4 py-2">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 px-0"
                onClick={() => {
                  setError('');
                  setCreating(true);
                }}
              >
                <Plus aria-hidden /> Create invite
              </Button>
            </div>
          </>
        )}
      </SettingsSection>
      {error && (
        <p role="alert" className="px-4 text-destructive text-sm">
          {error}
        </p>
      )}
      {creating && (
        <CreateInvite
          onCreate={(invite) =>
            setLoad((current) =>
              current.status === 'ready'
                ? { ...current, invites: [invite, ...current.invites] }
                : current,
            )
          }
          onAccessDenied={(failure) => denied(failure)}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function InviteRow({
  invite,
  state,
  onRemove,
}: {
  invite: Invite;
  state: InviteState;
  onRemove: () => void;
}) {
  const name = invite.label || 'Invite';
  return (
    <li aria-label={name} className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Link2
        className={cn(
          'size-5 shrink-0',
          state === 'usable' ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-muted-foreground text-sm">{describe(invite, state)}</p>
      </div>
      <span
        className={cn(
          'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 font-medium text-xs',
          state === 'usable'
            ? 'bg-accent text-accent-foreground'
            : 'bg-foreground/[0.07] text-muted-foreground',
        )}
      >
        {STATE_NAMES[state]}
      </span>
      <IconButton
        label={state === 'usable' ? `Revoke ${name}` : `Remove ${name}`}
        className="size-11 shrink-0 sm:size-8"
        onClick={onRemove}
      >
        <X />
      </IconButton>
    </li>
  );
}

function CreateInvite({
  onCreate,
  onAccessDenied,
  onClose,
}: {
  onCreate: (invite: Invite) => void;
  /** Whether the failure was the server turning this admin away, which it then handles. */
  onAccessDenied: (failure: unknown) => boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const labelId = useId();
  const labelField = useRef<HTMLInputElement>(null);
  const linkField = useRef<HTMLInputElement | null>(null);
  const focusLink = useCallback((field: HTMLInputElement | null) => {
    linkField.current = field;
    field?.focus({ preventScroll: true });
    field?.select();
  }, []);
  // An update's reload would lose a link nobody can read again.
  useEffect(() => (link === null ? undefined : holdUpdateReload()), [link]);
  const close = () => {
    if (!busy) onClose();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || link) return;
    setBusy(true);
    setError('');
    try {
      const made = await adminApi.createInvite({ label: label.trim() });
      onCreate(made.invite);
      setLink(inviteLink(getServerUrl(), made.token));
      haptics.success();
    } catch (failure) {
      if (onAccessDenied(failure)) return;
      setError(
        failure instanceof AdminRequestError && failure.status === 409
          ? 'There are too many usable invites. Remove some before making more.'
          : 'Could not make the invite. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptics.selection();
    } catch {
      // Selected instead, for the system's own copy.
      linkField.current?.focus();
      linkField.current?.select();
    }
  }

  const share =
    typeof navigator.share === 'function' && link
      ? () => {
          void navigator.share({ title: 'Join Throw', url: link }).catch(() => undefined);
        }
      : null;

  return (
    <ManagementSurface
      open
      title={link ? 'Copy the invite link' : 'Create invite'}
      onClose={close}
      initialFocusRef={link ? undefined : labelField}
      fit
    >
      {link ? (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-muted-foreground text-sm">
            Copy this link now: Throw only shows it once. It makes one account and expires in{' '}
            {INVITE_DAYS} days.
          </p>
          <Input
            ref={focusLink}
            readOnly
            value={link}
            className="font-mono"
            aria-label="Invite link"
            spellCheck={false}
            autoComplete="off"
            onFocus={(event) => event.target.select()}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {share && (
              <Button type="button" variant="secondary" className="rounded-full" onClick={share}>
                <Share2 aria-hidden /> Share
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              onClick={() => void copy()}
            >
              <Copy aria-hidden /> {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button type="button" className="rounded-full" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
          <label htmlFor={labelId} className="flex flex-col gap-2 font-medium text-sm">
            Who is it for?
            <Input
              id={labelId}
              ref={labelField}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              autoComplete="off"
              placeholder="Optional, for example Sam"
              maxLength={100}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={busy}>
              {busy ? 'Creating…' : 'Create invite'}
            </Button>
          </div>
        </form>
      )}
    </ManagementSurface>
  );
}
