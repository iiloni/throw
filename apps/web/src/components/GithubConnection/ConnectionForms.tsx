import {
  createGithubConnectionSchema,
  type GithubAuthMode,
  type GithubConnection,
  githubTokenSchema,
  parseGithubRepository,
  type UpdateGithubConnection,
} from '@throw/shared';
import { Check, KeyRound, type LucideIcon, Webhook } from 'lucide-react';
import { type FormEvent, type ReactNode, useContext, useId, useState } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { GithubConnectionContext } from '@/lib/githubSettings';
import { haptics } from '@/lib/haptics';
import { webhookErrorMessage } from '@/lib/webhookSettings';

const REPOSITORY_HINT = 'Enter the repository as owner/name, or paste its GitHub address.';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string, hintId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      {children(id, hint ? hintId : undefined)}
      {hint && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}

function RepositoryField({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: string;
  onChange: (repository: string) => void;
  disabled: boolean;
  hint: string;
}) {
  return (
    <Field label="Repository" hint={hint}>
      {(id, hintId) => (
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="owner/name"
          aria-describedby={hintId}
          required
          disabled={disabled}
        />
      )}
    </Field>
  );
}

const MODES: { value: GithubAuthMode; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: 'webhook',
    label: 'Webhook only',
    description: 'GitHub tells Throw what changes. Throw never calls GitHub.',
    icon: Webhook,
  },
  {
    value: 'token',
    label: 'Webhook and access token',
    description:
      'Also keeps a personal access token, encrypted on this server, for features that read from GitHub.',
    icon: KeyRound,
  },
];

/** Two cards, the whole of each the radio, as the move picker's targets are. */
function AuthMode({
  value,
  onChange,
  disabled,
}: {
  value: GithubAuthMode;
  onChange: (mode: GithubAuthMode) => void;
  disabled: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 font-medium text-sm">Access</legend>
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const checked = value === mode.value;
        return (
          <label
            key={mode.value}
            className="relative flex min-h-11 cursor-pointer select-none items-start gap-3 rounded-2xl border-2 border-transparent bg-foreground/[0.04] px-3 py-3 transition-colors duration-200 hover:bg-foreground/[0.07] has-[:checked]:border-brand has-[:checked]:bg-foreground/[0.08] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60 has-[:disabled]:cursor-default has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              value={mode.value}
              checked={checked}
              onChange={() => onChange(mode.value)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-[inherit] opacity-0"
            />
            <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-sm">{mode.label}</span>
              <span className="block text-muted-foreground text-sm">{mode.description}</span>
            </span>
            {checked && <Check className="mt-0.5 size-4 shrink-0" aria-hidden />}
          </label>
        );
      })}
    </fieldset>
  );
}

function TokenField({
  value,
  onChange,
  disabled,
  stored,
}: {
  value: string;
  onChange: (token: string) => void;
  disabled: boolean;
  stored: boolean;
}) {
  return (
    <Field
      label={stored ? 'Replace access token' : 'Personal access token'}
      hint={
        stored
          ? 'A token is stored. Leave this empty to keep it; Throw never shows it again.'
          : 'A fine-grained token limited to this repository. Throw stores it encrypted and never shows it again.'
      }
    >
      {(id, hintId) => (
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={stored ? 'Stored' : 'github_pat_…'}
          aria-describedby={hintId}
          required={!stored}
          disabled={disabled}
          className="font-mono"
        />
      )}
    </Field>
  );
}

/** A project with no repository: what to connect, and how Throw may reach it. */
export function Connect({ projectId }: { projectId: string }) {
  const settings = useContext(GithubConnectionContext)!;
  const [repository, setRepository] = useState('');
  const [authMode, setAuthMode] = useState<GithubAuthMode>('webhook');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = createGithubConnectionSchema.safeParse({
      repository,
      authMode,
      ...(authMode === 'token' ? { token } : {}),
    });
    if (!body.success) {
      setError(
        parseGithubRepository(repository) ? 'Paste the whole access token.' : REPOSITORY_HINT,
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.createGithubConnection(projectId, {
        repository: body.data.repository,
        authMode: body.data.authMode,
        ...(body.data.token === undefined ? {} : { token: body.data.token }),
      });
      haptics.success();
      settings.showSecret(result, false);
    } catch (failure) {
      setError(webhookErrorMessage(failure, 'Could not connect the repository. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Connect a repository"
      description="Link this project’s tasks to pull requests and issues in one repository. GitHub sends Throw signed webhooks, and Throw checks each one’s signature and repository before using it."
    >
      <form onSubmit={submit} className="flex flex-col gap-5 p-4">
        <RepositoryField
          value={repository}
          onChange={setRepository}
          disabled={busy}
          hint="For example, octo-org/website, or the repository’s address."
        />
        <AuthMode value={authMode} onChange={setAuthMode} disabled={busy} />
        {authMode === 'token' && (
          <TokenField value={token} onChange={setToken} disabled={busy} stored={false} />
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" className="min-h-11" disabled={busy || !repository.trim()}>
            {busy ? 'Connecting…' : 'Connect repository'}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

export function EditConnection({
  connection,
  onClose,
}: {
  connection: GithubConnection;
  onClose: () => void;
}) {
  const settings = useContext(GithubConnectionContext)!;
  const [repository, setRepository] = useState(connection.repository);
  const [authMode, setAuthMode] = useState(connection.authMode);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  const parsed = parseGithubRepository(repository);
  const changes: UpdateGithubConnection = {
    ...(parsed !== connection.repository ? { repository } : {}),
    ...(authMode !== connection.authMode ? { authMode } : {}),
    ...(authMode === 'token' && token.trim() ? { token } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    if (!parsed) return setError(REPOSITORY_HINT);
    if (changes.token !== undefined && !githubTokenSchema.safeParse(changes.token).success)
      return setError('Paste the whole access token.');
    if (authMode === 'token' && !connection.hasToken && !token.trim())
      return setError('Paste an access token to use it.');
    setBusy(true);
    setError('');
    try {
      settings.changed(
        (await api.updateGithubConnection(connection.projectId, changes)).connection,
      );
      haptics.success();
      onClose();
    } catch (failure) {
      setError(webhookErrorMessage(failure, 'Could not save the connection. Try again.'));
      setBusy(false);
    }
  }

  return (
    <ManagementSurface open title="Edit GitHub connection" onClose={close} fit>
      <form onSubmit={save} className="flex flex-col gap-5 pb-1">
        <RepositoryField
          value={repository}
          onChange={setRepository}
          disabled={busy}
          hint="Deliveries from any other repository are refused, so move the webhook on GitHub too."
        />
        <AuthMode value={authMode} onChange={setAuthMode} disabled={busy} />
        {authMode === 'token' && (
          <TokenField
            value={token}
            onChange={setToken}
            disabled={busy}
            stored={connection.hasToken}
          />
        )}
        {authMode === 'webhook' && connection.hasToken && (
          <p className="text-muted-foreground text-sm">Saving deletes the stored access token.</p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            {dirty ? 'Cancel' : 'Done'}
          </Button>
          {dirty && (
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </form>
    </ManagementSurface>
  );
}
