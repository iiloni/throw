import {
  createWebhookSchema,
  type UpdateWebhook,
  updateWebhookSchema,
  type Webhook,
  type WebhooksResponse,
  webhookUrlSchema,
} from '@throw/shared';
import { Copy, Plus, Webhook as WebhookIcon } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
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
import { WebhookSettingsContext, webhookErrorMessage } from '@/lib/webhookSettings';

type Workspaces = WebhooksResponse['workspaces'];

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const selectClass =
  'min-h-11 rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring';

export function Webhooks() {
  const settings = useContext(WebhookSettingsContext);
  if (!settings) return null;
  const { state, retry } = settings;
  if (state.status === 'ready') return <WebhookList inventory={state.inventory} />;
  return (
    <SettingsSection title="Webhooks">
      {state.status === 'loading' ? (
        <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
          Loading webhooks…
        </p>
      ) : state.status === 'unavailable' ? (
        <SettingsRow label="Webhooks require a newer Throw server" />
      ) : (
        <SettingsRow
          label="Could not load webhooks"
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

function deliverySummary(webhook: Webhook) {
  if (!webhook.lastDeliveryAt) return 'No deliveries yet';
  const at = when.format(new Date(webhook.lastDeliveryAt));
  return webhook.lastDeliveryStatus === 'ok'
    ? `Delivered ${at}`
    : `Failed ${at}${webhook.lastError ? `: ${webhook.lastError}` : ''}`;
}

function scopeOf(webhook: Webhook, workspaces: Workspaces) {
  const workspace = workspaces.find(({ id }) => id === webhook.workspaceId);
  if (!workspace) return null;
  const project = workspace.projects.find(({ id }) => id === webhook.projectId);
  return {
    workspace,
    label: `${workspace.name} · ${webhook.projectId ? (project?.name ?? 'Project in the trash') : 'All projects'}`,
  };
}

type Surface =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; webhook: Webhook }
  | { kind: 'secret'; webhook: Webhook; secret: string; title: string };

function WebhookList({ inventory }: { inventory: WebhooksResponse }) {
  const settings = useContext(WebhookSettingsContext)!;
  const [surface, setSurface] = useState<Surface | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const close = () => setSurface(null);
  const editing =
    surface?.kind === 'edit' ? inventory.webhooks.find(({ id }) => id === surface.id) : undefined;

  async function toggle(webhook: Webhook, enabled: boolean) {
    setToggling(webhook.id);
    setError('');
    try {
      settings.replaced((await api.updateWebhook(webhook.id, { enabled })).webhook);
    } catch {
      setError(`Could not turn ${webhook.name} ${enabled ? 'on' : 'off'}. Try again.`);
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Webhooks"
        description="Throw sends a signed notice when a workspace changes. The receiver reads what changed with MCP list_changes."
      >
        {inventory.webhooks.map((webhook) => {
          const scope = scopeOf(webhook, inventory.workspaces);
          return (
            <SettingsRow
              key={webhook.id}
              icon={WebhookIcon}
              label={<span className="break-all">{webhook.name}</span>}
              description={
                scope
                  ? `${scope.label} · ${webhook.enabled ? deliverySummary(webhook) : 'Off'}`
                  : 'Workspace access ended'
              }
            >
              {scope ? (
                <>
                  <Switch
                    aria-label={`Deliver to ${webhook.name}`}
                    checked={webhook.enabled}
                    disabled={toggling === webhook.id}
                    onCheckedChange={(enabled) => void toggle(webhook, enabled)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 shrink-0"
                    aria-label={`Edit ${webhook.name}`}
                    onClick={() => setSurface({ kind: 'edit', id: webhook.id })}
                  >
                    Edit
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 shrink-0"
                  aria-label={`Delete ${webhook.name}`}
                  onClick={() => setSurface({ kind: 'delete', webhook })}
                >
                  Delete
                </Button>
              )}
            </SettingsRow>
          );
        })}
        {inventory.webhooks.length === 0 && <SettingsRow label="No webhooks" />}
        {inventory.workspaces.length > 0 && (
          <div className="px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-0"
              onClick={() => setSurface({ kind: 'create' })}
            >
              <Plus aria-hidden /> Create webhook
            </Button>
          </div>
        )}
      </SettingsSection>
      {error && (
        <p role="alert" className="px-4 text-destructive text-sm">
          {error}
        </p>
      )}

      <SettingsSection
        title="Verify a delivery"
        description="Compare in constant time, and use the delivery ID to ignore repeats."
      >
        <p className="px-4 py-3 text-sm">
          Each POST has <code className="font-mono">X-Throw-Event</code>,{' '}
          <code className="font-mono">X-Throw-Delivery</code> and{' '}
          <code className="font-mono">X-Throw-Signature</code>:{' '}
          <code className="font-mono">sha256=</code> and the hex HMAC-SHA256 of the raw body, keyed
          with the webhook’s signing secret.
        </p>
      </SettingsSection>

      {surface?.kind === 'create' && (
        <CreateWebhook
          workspaces={inventory.workspaces}
          onCreate={settings.added}
          onClose={close}
        />
      )}
      {editing && (
        <EditWebhook
          webhook={editing}
          workspaces={inventory.workspaces}
          onChange={settings.replaced}
          onRotated={(webhook, secret) => {
            settings.replaced(webhook);
            setSurface({ kind: 'secret', webhook, secret, title: 'Copy the new secret' });
          }}
          onDelete={() => setSurface({ kind: 'delete', webhook: editing })}
          onClose={close}
        />
      )}
      {surface?.kind === 'delete' && (
        <DeleteWebhook webhook={surface.webhook} onDelete={settings.removed} onClose={close} />
      )}
      {surface?.kind === 'secret' && (
        <ManagementSurface open title={surface.title} onClose={close} fit>
          <RevealSecret secret={surface.secret} onDone={close} />
        </ManagementSurface>
      )}
    </div>
  );
}

function RevealSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const focus = useCallback((input: HTMLInputElement | null) => {
    field.current = input;
    input?.focus({ preventScroll: true });
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <p className="text-muted-foreground text-sm">
        Copy this signing secret now. Throw only shows it once.
      </p>
      <Input
        ref={focus}
        readOnly
        value={secret}
        className="font-mono"
        aria-label="Signing secret"
        spellCheck={false}
        autoComplete="off"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          <Copy aria-hidden /> {copied ? 'Copied' : 'Copy secret'}
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function ProjectSelect({
  id,
  projects,
  value,
  onChange,
  disabled,
}: {
  id: string;
  projects: Workspaces[number]['projects'];
  value: string | null;
  onChange: (projectId: string | null) => void;
  disabled: boolean;
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      className={selectClass}
      disabled={disabled}
    >
      <option value="">All projects</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name} ({project.key})
        </option>
      ))}
      {value && !projects.some(({ id }) => id === value) && (
        <option value={value}>Project in the trash</option>
      )}
    </select>
  );
}

function IgnoreTokenWrites({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="font-medium text-sm">
          Ignore agent writes
        </label>
        <p className="text-muted-foreground text-sm">Skip changes made through MCP tokens.</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function CreateWebhook({
  workspaces,
  onCreate,
  onClose,
}: {
  workspaces: Workspaces;
  onCreate: (webhook: Webhook) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [ignoreTokenWrites, setIgnoreTokenWrites] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameField = useRef<HTMLInputElement>(null);
  const projects = workspaces.find(({ id }) => id === workspaceId)?.projects ?? [];
  const close = () => {
    if (!busy) onClose();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || secret) return;
    const body = createWebhookSchema.safeParse({
      name,
      url,
      workspaceId,
      projectId,
      ignoreTokenWrites,
    });
    if (!body.success) {
      setError(
        webhookUrlSchema.safeParse(url).success
          ? 'Enter a name and choose a workspace.'
          : 'Enter a full URL, starting with https://',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.createWebhook(body.data);
      onCreate(created.webhook);
      setSecret(created.secret);
    } catch (failure) {
      setError(webhookErrorMessage(failure, 'Could not create the webhook. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ManagementSurface
      open
      title={secret ? 'Copy your signing secret' : 'Create webhook'}
      onClose={close}
      initialFocusRef={secret ? undefined : nameField}
      fit
    >
      {secret ? (
        <RevealSecret secret={secret} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                ref={nameField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                placeholder="For example, agent wake-up"
                maxLength={80}
                required
                disabled={busy}
              />
            )}
          </Field>
          <Field label="Receiver URL">
            {(id) => (
              <Input
                id={id}
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                required
                disabled={busy}
              />
            )}
          </Field>
          <Field label="Workspace">
            {(id) => (
              <select
                id={id}
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                  setProjectId(null);
                }}
                className={selectClass}
                required
                disabled={busy}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Project">
            {(id) => (
              <ProjectSelect
                id={id}
                projects={projects}
                value={projectId}
                onChange={setProjectId}
                disabled={busy}
              />
            )}
          </Field>
          <IgnoreTokenWrites
            checked={ignoreTokenWrites}
            onChange={setIgnoreTokenWrites}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !url.trim()}>
              {busy ? 'Creating…' : 'Create webhook'}
            </Button>
          </div>
        </form>
      )}
    </ManagementSurface>
  );
}

function EditWebhook({
  webhook,
  workspaces,
  onChange,
  onRotated,
  onDelete,
  onClose,
}: {
  webhook: Webhook;
  workspaces: Workspaces;
  onChange: (webhook: Webhook) => void;
  onRotated: (webhook: Webhook, secret: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(webhook.name);
  const [url, setUrl] = useState(webhook.url);
  const [projectId, setProjectId] = useState(webhook.projectId);
  const [ignoreTokenWrites, setIgnoreTokenWrites] = useState(webhook.ignoreTokenWrites);
  const [busy, setBusy] = useState<'save' | 'test' | 'secret' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const workspace = workspaces.find(({ id }) => id === webhook.workspaceId);
  const close = () => {
    if (!busy) onClose();
  };

  const changes: UpdateWebhook = {
    ...(name.trim() !== webhook.name ? { name } : {}),
    ...(url.trim() !== webhook.url ? { url } : {}),
    ...(projectId !== webhook.projectId ? { projectId } : {}),
    ...(ignoreTokenWrites !== webhook.ignoreTokenWrites ? { ignoreTokenWrites } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    const body = updateWebhookSchema.safeParse(changes);
    if (!body.success) {
      setError(
        changes.url === undefined || webhookUrlSchema.safeParse(changes.url).success
          ? 'Enter a name.'
          : 'Enter a full URL, starting with https://',
      );
      return;
    }
    setBusy('save');
    setError('');
    try {
      onChange((await api.updateWebhook(webhook.id, body.data)).webhook);
      onClose();
    } catch (failure) {
      setError(webhookErrorMessage(failure, 'Could not save the webhook. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    setError('');
    setResult('');
    try {
      const outcome = await api.testWebhook(webhook.id);
      onChange(outcome.webhook);
      setResult(
        outcome.ok
          ? `Test delivered (HTTP ${outcome.responseStatus})`
          : `Test failed: ${outcome.error ?? 'unknown error'}`,
      );
    } catch {
      setError('Could not send the test. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy('secret');
    setError('');
    try {
      const rotated = await api.rotateWebhookSecret(webhook.id);
      setBusy(null);
      onRotated(rotated.webhook, rotated.secret);
    } catch {
      setError('Could not make a new secret. Try again.');
      setBusy(null);
    }
  }

  return (
    <ManagementSurface open title="Edit webhook" onClose={close} fit>
      <form onSubmit={save} className="flex flex-col gap-4 px-4 pb-4">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              maxLength={80}
              required
              disabled={busy !== null}
            />
          )}
        </Field>
        <Field label="Receiver URL">
          {(id) => (
            <Input
              id={id}
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy !== null}
            />
          )}
        </Field>
        <Field label={`Project in ${workspace?.name ?? 'the workspace'}`}>
          {(id) => (
            <ProjectSelect
              id={id}
              projects={workspace?.projects ?? []}
              value={projectId}
              onChange={setProjectId}
              disabled={busy !== null}
            />
          )}
        </Field>
        <IgnoreTokenWrites
          checked={ignoreTokenWrites}
          onChange={setIgnoreTokenWrites}
          disabled={busy !== null}
        />
        <div className="flex flex-col gap-1 rounded-xl bg-foreground/[0.05] px-3 py-2 text-sm">
          <p className="font-medium">Last delivery</p>
          <p className="break-words text-muted-foreground">{deliverySummary(webhook)}</p>
          {result && (
            <p role="status" className="break-words">
              {result}
            </p>
          )}
        </div>
        {confirmRotate ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2 text-sm">
            <p>Receivers that check the old secret will reject deliveries until you update them.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setConfirmRotate(false)}
              >
                Keep secret
              </Button>
              <Button type="button" disabled={busy !== null} onClick={() => void rotate()}>
                {busy === 'secret' ? 'Making…' : 'Make new secret'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void sendTest()}
            >
              {busy === 'test' ? 'Sending…' : 'Send test'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmRotate(true)}
            >
              New secret
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={busy !== null}
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={close}>
            {dirty ? 'Cancel' : 'Done'}
          </Button>
          {dirty && (
            <Button type="submit" disabled={busy !== null || !name.trim() || !url.trim()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </form>
    </ManagementSurface>
  );
}

function DeleteWebhook({
  webhook,
  onDelete,
  onClose,
}: {
  webhook: Webhook;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
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
      await api.deleteWebhook(webhook.id);
      onDelete(webhook.id);
      onClose();
    } catch {
      setError('Could not delete the webhook. Try again.');
      setBusy(false);
    }
  }

  return (
    <ManagementSurface open title="Delete webhook" onClose={close} fit>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="break-words text-muted-foreground text-sm">
          “{webhook.name}” stops receiving deliveries, including any still queued.
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
            {busy ? 'Deleting…' : 'Delete webhook'}
          </Button>
        </div>
      </div>
    </ManagementSurface>
  );
}
