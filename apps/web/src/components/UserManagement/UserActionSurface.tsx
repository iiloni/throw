import type { AdminUser, UserRole } from '@throw/shared';
import { Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminRequestError, adminApi } from '@/lib/admin';
import { haptics } from '@/lib/haptics';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';

export type UserAction =
  | { kind: 'role'; user: AdminUser; role: UserRole }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser };

type Props = {
  action: UserAction | null;
  onClose: () => void;
  onChanged: (user: AdminUser) => void;
  onDeleted: (user: AdminUser) => void;
  onAccessDenied: () => void;
};

export const nameOf = (user: AdminUser) => user.name || user.email;

function copyFor(action: UserAction) {
  const { user } = action;
  if (action.kind === 'role')
    return action.role === 'admin'
      ? {
          title: `Make ${nameOf(user)} an admin?`,
          body: 'They can manage every account on this server, invite people and restore backups.',
          confirm: 'Make admin',
          busy: 'Saving…',
          destructive: false,
        }
      : {
          title: `Remove ${nameOf(user)}’s admin access?`,
          body: 'They keep their account and workspaces, but can no longer open the admin pages.',
          confirm: 'Remove admin access',
          busy: 'Saving…',
          destructive: true,
        };
  if (action.kind === 'reset')
    return {
      title: 'Reset password?',
      body: `Throw replaces the password for ${user.email} with a temporary one and signs them out on every device.`,
      confirm: 'Reset password',
      busy: 'Resetting…',
      destructive: true,
    };
  return {
    title: 'Delete user?',
    body: `${user.email} is signed out everywhere and their account is removed. Workspaces nobody else belongs to are deleted with every project and task in them. This cannot be undone.`,
    confirm: 'Delete user',
    busy: 'Deleting…',
    destructive: true,
  };
}

/**
 * Asks before changing someone's role, password or account, then does it. A reset ends on the
 * temporary password, shown this once (ADR 0018).
 */
export function UserActionSurface({
  action,
  onClose,
  onChanged,
  onDeleted,
  onAccessDenied,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  // The last action stays drawn while the surface closes.
  const [shown, setShown] = useState(action);
  if (action && action !== shown) {
    setShown(action);
    setBusy(false);
    setError('');
    setPassword(null);
  }
  // An update's reload would lose a temporary password nobody can read again.
  useEffect(() => (password === null ? undefined : holdUpdateReload()), [password]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  async function confirm() {
    if (!action || busy) return;
    setBusy(true);
    setError('');
    try {
      if (action.kind === 'role') {
        const updated = await adminApi.setRole(action.user.id, action.role);
        onChanged(updated);
        toast.success(
          updated.role === 'admin'
            ? `${nameOf(updated)} is now an admin`
            : `${nameOf(updated)} is no longer an admin`,
        );
        haptics.success();
        onClose();
      } else if (action.kind === 'reset') {
        const result = await adminApi.resetPassword(action.user.id);
        setPassword(result.temporaryPassword);
        haptics.success();
      } else {
        await adminApi.deleteUser(action.user.id);
        haptics.warning();
        onDeleted(action.user);
        onClose();
      }
    } catch (failure) {
      if (failure instanceof AdminRequestError && failure.accessDenied) {
        onClose();
        onAccessDenied();
        return;
      }
      setError(
        failure instanceof AdminRequestError && failure.status !== 0
          ? failure.message
          : 'Could not reach the Throw server. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const copy = shown && copyFor(shown);
  return (
    <ManagementSurface
      open={action !== null}
      title={password ? 'Temporary password' : (copy?.title ?? '')}
      onClose={close}
      fit
    >
      {password && shown ? (
        <TemporaryPassword password={password} email={shown.user.email} onDone={onClose} />
      ) : (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">{copy?.body}</p>
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
            <Button
              type="button"
              variant={copy?.destructive ? 'destructive' : 'default'}
              className="rounded-full"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? copy?.busy : copy?.confirm}
            </Button>
          </div>
        </div>
      )}
    </ManagementSurface>
  );
}

function TemporaryPassword({
  password,
  email,
  onDone,
}: {
  password: string;
  email: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const select = useCallback(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  useEffect(select, [select]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      haptics.selection();
    } catch {
      // Selected instead, for the system's own copy.
      select();
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
        Give this password to {email}. Throw only shows it once; they can change it in Account
        settings after signing in.
      </p>
      <Input
        ref={field}
        readOnly
        value={password}
        aria-label="Temporary password"
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => event.target.select()}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="rounded-full"
          onClick={() => void copy()}
        >
          <Copy aria-hidden /> {copied ? 'Copied' : 'Copy password'}
        </Button>
        <Button type="button" className="rounded-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
