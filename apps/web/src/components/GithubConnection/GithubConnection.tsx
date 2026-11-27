import {
  createGithubConnectionSchema,
  type GithubAuthMode,
  type GithubConnection,
  type GithubDelivery,
  githubTokenSchema,
  parseGithubRepository,
  type UpdateGithubConnection,
} from '@throw/shared';
import { Copy, GitPullRequest, RefreshCw } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { GithubConnectionContext } from '@/lib/githubSettings';
import { haptics } from '@/lib/haptics';
import { webhookErrorMessage } from '@/lib/webhookSettings';

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const REPOSITORY_HINT = 'Enter the repository as owner/name, or paste its GitHub address.';

/** A project's GitHub repository, its inbound webhook and what GitHub last sent (ADR 0017). */
export function GithubConnectionSettings({ projectId }: { projectId: string }) {
  const settings = useContext(GithubConnectionContext);
  if (!settings) return null;
  const { state, retry, dismissSecret } = settings;
  if (state.status === 'ready') {
    if (!state.connection) return <Connect projectId={projectId} />;
    return (
      <>
        <Connected connection={state.connection} />
        {state.setup && (
          <ManagementSurface
            open
            title={state.setup.rotated ? 'Copy the new secret' : 'Add the webhook on GitHub'}
            onClose={dismissSecret}
            fit
          >
            {state.setup.rotated ? (
              <div className="flex flex-col gap-4 px-4 pb-4">
                <p className="text-muted-foreground text-sm">
                  Paste it into the webhook’s Secret field on GitHub. Throw only shows it once.
                </p>
                <CopyField label="Secret" value={state.setup.secret} />
                <div className="flex justify-end">
                  <Button type="button" onClick={dismissSecret}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <WebhookSetup
                connection={state.connection}
                secret={state.setup.secret}
                onDone={dismissSecret}
              />
            )}
          </ManagementSurface>
        )}
      </>
    );
  }
  return (
    <SettingsSection title="GitHub">
      {state.status === 'loading' ? (
        <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
          Loading the GitHub connection…
        </p>
      ) : state.status === 'unavailable' ? (
        <SettingsRow label="GitHub needs a newer Throw server" />
      ) : (
        <SettingsRow
          label="Could not load the GitHub connection"
          description="Check your connection and try again."
        >
          <Button type="button" variant="secondary" onClick={retry}>
            Retry
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

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
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}

const MODES: { value: GithubAuthMode; label: string; description: string }[] = [
  {
    value: 'webhook',
    label: 'Webhook only',
    description: 'GitHub tells Throw what happens. Throw never calls GitHub.',
  },
  {
    value: 'token',
    label: 'Webhook and access token',
    description:
      'Also keeps a personal access token, encrypted on this server, for features that read from GitHub.',
  },
];

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
      {MODES.map((mode) => (
        <label
          key={mode.value}
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-foreground/[0.04] px-3 py-2.5 has-[:checked]:bg-tint has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60"
          data-color="blue"
        >
          <input
            type="radio"
            name={name}
            value={mode.value}
            checked={value === mode.value}
            onChange={() => onChange(mode.value)}
            className="mt-1 size-4 accent-[var(--tint-accent)]"
          />
          <span className="min-w-0">
            <span className="block font-medium text-sm">{mode.label}</span>
            <span className="block text-muted-foreground text-sm">{mode.description}</span>
          </span>
        </label>
      ))}
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
        />
      )}
    </Field>
  );
}

function Connect({ projectId }: { projectId: string }) {
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
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Connect a repository"
        description="GitHub sends this project signed webhooks. Throw checks each one against its secret and the repository before using it."
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <Field label="Repository" hint="For example, octo-org/website.">
            {(id, hintId) => (
              <Input
                id={id}
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="owner/name"
                aria-describedby={hintId}
                required
                disabled={busy}
              />
            )}
          </Field>
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
            <Button type="submit" disabled={busy || !repository.trim()}>
              {busy ? 'Connecting…' : 'Connect repository'}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

function CopyField({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          ref={field}
          readOnly
          value={value}
          className={mono ? 'font-mono' : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 shrink-0"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copy()}
        >
          <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/** What to enter in the repository's Settings → Webhooks → Add webhook. */
function WebhookSetup({
  connection,
  secret,
  onDone,
}: {
  connection: GithubConnection;
  secret: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <p className="text-muted-foreground text-sm">
        In {connection.repository} on GitHub, open Settings, then Webhooks, and add a webhook with
        these values. Choose <span className="font-medium text-foreground">application/json</span>{' '}
        as the content type. Throw only shows this secret once.
      </p>
      <CopyField label="Payload URL" value={connection.webhookUrl} />
      <CopyField label="Secret" value={secret} />
      <p className="text-muted-foreground text-sm">
        GitHub sends a ping when the webhook is saved. It shows here as the last delivery.
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function deliveryLabel(delivery: GithubDelivery | null) {
  if (!delivery) return 'No deliveries yet';
  const at = when.format(new Date(delivery.at));
  const event = delivery.event ?? 'delivery';
  if (delivery.status === 'ok') return `Received ${event} · ${at}`;
  if (delivery.status === 'ignored') return `Ignored ${event} · ${at}`;
  return `Refused ${event} · ${at}`;
}

type Surface = 'edit' | 'secret' | 'url' | 'disconnect';

function Connected({ connection }: { connection: GithubConnection }) {
  const settings = useContext(GithubConnectionContext)!;
  const [surface, setSurface] = useState<Surface | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const close = () => setSurface(null);
  const { refresh } = settings;

  // A delivery GitHub made while the page was in the background shows on return.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  async function toggle(enabled: boolean) {
    setToggling(true);
    setError('');
    try {
      settings.changed(
        (await api.updateGithubConnection(connection.projectId, { enabled })).connection,
      );
    } catch {
      setError(`Could not turn the connection ${enabled ? 'on' : 'off'}. Try again.`);
    } finally {
      setToggling(false);
    }
  }

  const delivery = connection.lastDelivery;
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Repository"
        description={
          connection.authMode === 'token'
            ? 'Throw holds an access token for this repository, encrypted on the server.'
            : 'Throw receives GitHub’s webhooks for this repository and never calls GitHub.'
        }
      >
        <SettingsRow
          icon={GitPullRequest}
          label={<span className="break-all">{connection.repository}</span>}
          description={
            connection.authMode === 'token' ? 'Webhook and access token' : 'Webhook only'
          }
        >
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 shrink-0"
            onClick={() => setSurface('edit')}
          >
            Edit
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Receive deliveries"
          description={
            connection.enabled ? 'On' : 'Off: GitHub’s deliveries are recorded and ignored'
          }
        >
          <Switch
            aria-label="Receive deliveries"
            checked={connection.enabled}
            disabled={toggling}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
        </SettingsRow>
      </SettingsSection>
      {error && (
        <p role="alert" className="px-4 text-destructive text-sm">
          {error}
        </p>
      )}

      <SettingsSection
        title="Webhook"
        description="Use application/json as the content type. Throw ignores events it does not use yet."
      >
        <div className="flex flex-col gap-4 p-4">
          <CopyField label="Payload URL" value={connection.webhookUrl} />
          <p className="text-muted-foreground text-sm">
            The secret was shown when it was made. Make a new one if it is lost.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setSurface('secret')}>
              New secret
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSurface('url')}>
              New URL
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Last delivery"
        action={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Check for new deliveries"
            onClick={refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        }
      >
        <div className="flex flex-col gap-1 px-4 py-3 text-sm" data-testid="github-last-delivery">
          <p className="font-medium" role="status">
            {deliveryLabel(delivery)}
          </p>
          {delivery?.detail && (
            <p
              className={
                delivery.status === 'error'
                  ? 'break-words text-destructive'
                  : 'break-words text-muted-foreground'
              }
            >
              {delivery.detail}
            </p>
          )}
          {delivery?.id && (
            <p className="break-all font-mono text-muted-foreground text-xs">{delivery.id}</p>
          )}
        </div>
      </SettingsSection>

      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          onClick={() => setSurface('disconnect')}
          className="flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          Disconnect GitHub
        </button>
      </div>

      {surface === 'edit' && <EditConnection connection={connection} onClose={close} />}
      {surface === 'secret' && (
        <Rotate
          title="Make a new secret?"
          body="GitHub’s deliveries are refused until you paste the new secret into the webhook on GitHub."
          action="Make new secret"
          onConfirm={async () => {
            const rotated = await api.rotateGithubSecret(connection.projectId);
            close();
            settings.showSecret(rotated, true);
          }}
          onClose={close}
        />
      )}
      {surface === 'url' && (
        <Rotate
          title="Move the webhook to a new URL?"
          body="The current URL stops answering at once. Paste the new one into the webhook on GitHub."
          action="Make new URL"
          onConfirm={async () => {
            settings.changed((await api.rotateGithubUrl(connection.projectId)).connection);
            close();
          }}
          onClose={close}
        />
      )}
      {surface === 'disconnect' && <Disconnect connection={connection} onClose={close} />}
    </div>
  );
}

function Rotate({
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  action: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <ManagementSurface open title={title} onClose={close} fit>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-muted-foreground text-sm">{body}</p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirm();
              } catch {
                setError('Could not make the change. Try again.');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Making…' : action}
          </Button>
        </div>
      </div>
    </ManagementSurface>
  );
}

function EditConnection({
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
      onClose();
    } catch (failure) {
      setError(webhookErrorMessage(failure, 'Could not save the connection. Try again.'));
      setBusy(false);
    }
  }

  return (
    <ManagementSurface open title="Edit GitHub connection" onClose={close} fit>
      <form onSubmit={save} className="flex flex-col gap-4 px-4 pb-4">
        <Field
          label="Repository"
          hint="Deliveries for any other repository are refused, so update the webhook on GitHub too."
        >
          {(id, hintId) => (
            <Input
              id={id}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={hintId}
              required
              disabled={busy}
            />
          )}
        </Field>
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
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
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

function Disconnect({
  connection,
  onClose,
}: {
  connection: GithubConnection;
  onClose: () => void;
}) {
  const settings = useContext(GithubConnectionContext)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteGithubConnection(connection.projectId);
      haptics.warning();
      settings.removed();
    } catch {
      setError('Could not disconnect. Try again.');
      setBusy(false);
    }
  }

  return (
    <ManagementSurface open title={`Disconnect ${connection.repository}?`} onClose={close} fit>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-muted-foreground text-sm">
          Throw forgets the secret{connection.hasToken ? ' and the access token' : ''}, and the
          webhook URL stops answering. Delete the webhook on GitHub as well.
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      </div>
    </ManagementSurface>
  );
}
