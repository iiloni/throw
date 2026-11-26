import { Capacitor } from '@capacitor/core';
import { KeyRound, LogOut, Server, UserRound } from 'lucide-react';
import { type CSSProperties, type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signOutCurrentAccount as endSession } from '@/lib/accounts';
import { authClient, changeAccountName, getSignedInUser, type SignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { updateSyncStatus, useSyncStatus } from '@/lib/syncStatus';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { cn } from '@/lib/utils';

/** Better Auth's default password limits, which the server enforces. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** The account page: who is signed in, their name and password, and signing out. */
export function AccountSettings() {
  const [user, setUser] = useState(getSignedInUser);
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Signed in as">
        {user && <AccountSummary user={user} />}
        {user && <ChangeName name={user.name} onChanged={() => setUser(getSignedInUser())} />}
        {Capacitor.isNativePlatform() && (
          <SettingsRow icon={Server} label="Server" description={getServerUrl()} />
        )}
      </SettingsSection>
      <ChangePassword />
      <SignOut />
    </div>
  );
}

function initials(name: string, email: string) {
  return (name.trim() || email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** A hue that stays with an account, as Catch's avatars have. */
function accountHue(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash % 360;
}

function AccountSummary({ user }: { user: SignedInUser }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span
        aria-hidden
        style={{ '--avatar-hue': accountHue(user.id) } as CSSProperties}
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[light-dark(oklch(0.86_0.11_var(--avatar-hue)),oklch(0.4_0.09_var(--avatar-hue)))] font-semibold text-[light-dark(oklch(0.32_0.08_var(--avatar-hue)),oklch(0.92_0.05_var(--avatar-hue)))] text-lg"
      >
        {initials(user.name, user.email)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium">{user.name || user.email}</p>
        {user.name && <p className="truncate text-muted-foreground text-sm">{user.email}</p>}
      </div>
    </div>
  );
}

const rowButton = 'h-11 rounded-full';

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  ) : null;
}

function FormActions({
  pending,
  label,
  onCancel,
}: {
  pending: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}

export function ChangeName({ name, onChanged }: { name: string; onChanged: () => void }) {
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An update waits for a changed name to be saved or dropped.
  const unsaved = open && draft !== name;
  useEffect(() => (unsaved ? holdUpdateReload() : undefined), [unsaved]);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      setError('Enter a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await changeAccountName(next);
      if (result.error) {
        setError(result.error.message || 'Could not change your name.');
        return;
      }
      onChanged();
      setOpen(false);
      haptics.success();
      toast.success('Name changed');
    } catch {
      setError('Could not change your name. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsRow icon={UserRound} label="Name" description={name || undefined}>
      <Button
        variant="outline"
        className={rowButton}
        onClick={() => {
          setDraft(name);
          setError(null);
          setOpen(true);
        }}
      >
        Change name
      </Button>
      <ManagementSurface open={open} title="Change name" onClose={close} initialFocusRef={field}>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 pb-1">
          <label htmlFor={fieldId} className="flex flex-col gap-2 font-medium text-sm">
            Name
            <Input
              ref={field}
              id={fieldId}
              autoComplete="name"
              required
              maxLength={80}
              value={draft}
              disabled={pending}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <FormError error={error} />
          <FormActions pending={pending} label="Save name" onCancel={close} />
        </form>
      </ManagementSurface>
    </SettingsRow>
  );
}

export function ChangePassword() {
  const formId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsaved = open && (current !== '' || next !== '' || confirmation !== '');
  useEffect(() => (unsaved ? holdUpdateReload() : undefined), [unsaved]);

  function reset() {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirmation('');
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
      setError(`Use a password between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`);
      return;
    }
    if (next !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      // The answer carries this device's new token; the auth client keeps it.
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(result.error.message || 'Could not change your password.');
        return;
      }
      // The old session's requests can be refused before the new token arrives; this device
      // is signed in on the new one.
      updateSyncStatus({ signedOut: false });
      reset();
      haptics.success();
      toast.success('Password changed');
    } catch {
      setError('Could not change your password. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  const passwordField = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    autoComplete: string,
    ref?: typeof field,
  ) => (
    <label htmlFor={id} className="flex flex-col gap-2 font-medium text-sm">
      {label}
      <Input
        ref={ref}
        id={id}
        type="password"
        autoComplete={autoComplete}
        required
        maxLength={PASSWORD_MAX}
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );

  return (
    <SettingsSection title="Security">
      <SettingsRow icon={KeyRound} label="Password">
        <Button variant="outline" className={rowButton} onClick={() => setOpen(true)}>
          Change password
        </Button>
        <ManagementSurface
          open={open}
          title="Change password"
          onClose={() => {
            if (!pending) reset();
          }}
          initialFocusRef={field}
        >
          <p className="mb-4 text-muted-foreground text-sm">
            Use at least {PASSWORD_MIN} characters. Your other devices will be signed out, and keep
            their unsaved changes until you sign in on them again.
          </p>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 pb-1">
            {passwordField(
              `${formId}-current`,
              'Current password',
              current,
              setCurrent,
              'current-password',
              field,
            )}
            {passwordField(`${formId}-new`, 'New password', next, setNext, 'new-password')}
            {passwordField(
              `${formId}-confirm`,
              'Confirm new password',
              confirmation,
              setConfirmation,
              'new-password',
            )}
            <FormError error={error} />
            <FormActions pending={pending} label="Save password" onCancel={reset} />
          </form>
        </ManagementSurface>
      </SettingsRow>
    </SettingsSection>
  );
}

export function SignOut() {
  const { pending } = useSyncStatus();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  function signOut() {
    setLeaving(true);
    void endSession();
  }

  return (
    <>
      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          disabled={leaving}
          onClick={() => (pending > 0 ? setConfirming(true) : signOut())}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60',
            leaving && 'opacity-60',
          )}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
      <ManagementSurface
        open={confirming}
        title="Sign out?"
        fit
        onClose={() => {
          if (!leaving) setConfirming(false);
        }}
      >
        <p className="mb-5 text-muted-foreground text-sm">
          {pending === 1
            ? 'Signing out deletes 1 change that has not reached the server.'
            : `Signing out deletes ${pending} changes that have not reached the server.`}
        </p>
        <div className="flex justify-end gap-2 pb-1">
          <Button variant="ghost" disabled={leaving} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={leaving}
            onClick={() => {
              haptics.warning();
              signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </ManagementSurface>
    </>
  );
}
