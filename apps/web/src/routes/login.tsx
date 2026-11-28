import { createFileRoute, redirect } from '@tanstack/react-router';
import { INVITE_HEADER, inviteFromFragment, inviteFromText } from '@throw/shared';
import { type FormEvent, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  accountPath,
  activateAccount,
  authClient,
  getAccounts,
  getSignedInUser,
  takeExpiredUser,
} from '@/lib/auth';
import { authRedirectSearchSchema, authReturnTo } from '@/lib/authRedirect';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/login')({
  validateSearch: authRedirectSearchSchema,
  beforeLoad: ({ search, location }) => {
    if (needsServerUrl()) throw redirect({ to: '/setup', search, hash: location.hash });
  },
  component: LoginPage,
});

// Prefill the seeded admin for Vite and bundled worktree builds. Other bundles strip this.
const devCredentials =
  import.meta.env.DEV || import.meta.env.THROW_DEV_SERVER_URL
    ? { email: 'admin@example.com', password: 'adminadmin' }
    : undefined;

function LoginPage() {
  const { redirect: returnTo } = Route.useSearch();
  // An invite link opens the form to make the account it is for (ADR 0018).
  const [invite] = useState(() => inviteFromFragment(window.location.hash));
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(invite ? 'sign-up' : 'sign-in');
  // The invited person makes their own account: the seeded admin's details would be in the way.
  const prefill = invite ? undefined : devCredentials;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Reached to add another account, or after the session in use ended (ADR 0016).
  const [signedIn] = useState(() => getAccounts()[0]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    // The Android app, and a page the link's fragment did not reach, take the link here.
    const pasted = mode === 'sign-up' ? String(form.get('invite') ?? '').trim() : '';
    const token = invite ?? (pasted ? inviteFromText(pasted) : null);
    if (pasted && !token) {
      setError('That is not a whole invite link. Copy the link again and paste all of it.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email(
              { email, password, name: String(form.get('name') ?? '') },
              token ? { headers: { [INVITE_HEADER]: token } } : undefined,
            );
      if (result.error) {
        setError(result.error.message ?? 'Something went wrong');
        return;
      }
      // Another account than the one whose session expired cannot use its page.
      const expired = takeExpiredUser();
      const { user } = result.data;
      const sameAccount = !expired || expired === user.id;
      // An invite's fragment is spent: it must not ride along to the destination.
      const fragment = invite ? '' : window.location.hash;
      const destination = sameAccount ? authReturnTo(returnTo, fragment) : '/';
      // A full load, so the collections open this user's copy of their data on the device,
      // at this account's addresses once several are signed in.
      window.location.assign(accountPath(user.id, destination));
    } catch {
      setError('Could not reach the Throw server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <h1>
        <BrandLockup orientation="horizontal" iconSize={48} />
      </h1>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        {invite && mode === 'sign-up' && (
          <p role="status" className="text-center text-muted-foreground text-sm">
            You have been invited to this Throw server. Make your account to join.
          </p>
        )}
        {mode === 'sign-up' && <Input name="name" placeholder="Name" aria-label="Name" />}
        <Input
          name="email"
          type="email"
          required
          defaultValue={prefill?.email}
          placeholder="Email"
          aria-label="Email"
        />
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          defaultValue={prefill?.password}
          placeholder="Password"
          aria-label="Password"
        />
        {mode === 'sign-up' && !invite && (
          <Input
            name="invite"
            autoComplete="off"
            spellCheck={false}
            placeholder="Invite link, if you were sent one"
            aria-label="Invite link"
          />
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        >
          {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </Button>
        {signedIn && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // A full load: the collections open the data of the account in use.
              const user = getSignedInUser();
              if (!user) activateAccount(signedIn.user.id);
              window.location.assign(accountPath((user ?? signedIn.user).id));
            }}
          >
            Back to your tasks
          </Button>
        )}
      </form>
    </main>
  );
}
