import type { GithubConnection, GithubDelivery, Status } from '@throw/shared';
import { ArrowUpRight, FolderGit2, RefreshCw, Unplug } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useContext, useEffect, useState } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { GithubConnectionContext } from '@/lib/githubSettings';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Connect, EditConnection } from './ConnectionForms';
import { GithubStatusRules } from './StatusRules';
import { CONTENT_TYPE, CopyField, NewSecret, WebhookSetup } from './WebhookSetup';

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A project's GitHub repository, its inbound webhook and what GitHub last sent (ADR 0017). */
export function GithubConnectionSettings({
  projectId,
  statuses,
}: {
  projectId: string;
  /** The project's statuses, for its status rules, or null while they first load. */
  statuses: readonly Status[] | null;
}) {
  const settings = useContext(GithubConnectionContext);
  if (!settings) return null;
  const { state, retry, dismissSecret } = settings;
  if (state.status === 'ready') {
    if (!state.connection) return <Connect projectId={projectId} />;
    return (
      <>
        <Connected connection={state.connection} statuses={statuses} />
        {state.setup && (
          <ManagementSurface
            open
            title={state.setup.rotated ? 'Copy the new secret' : 'Add the webhook on GitHub'}
            onClose={dismissSecret}
            fit
          >
            {state.setup.rotated ? (
              <NewSecret
                connection={state.connection}
                secret={state.setup.secret}
                onDone={dismissSecret}
              />
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

const OUTCOMES = {
  ok: { label: 'Received', color: 'green' },
  ignored: { label: 'Ignored', color: undefined },
  error: { label: 'Refused', color: 'red' },
} as const;

/** What GitHub last sent: a quiet pill for how it went, the event, when, and why. */
function LastDelivery({ delivery }: { delivery: GithubDelivery | null }) {
  if (!delivery)
    return (
      <div className="flex flex-col gap-0.5 px-4 py-3.5" data-testid="github-last-delivery">
        <p role="status" className="font-medium">
          No deliveries yet
        </p>
        <p className="text-muted-foreground text-sm">
          GitHub sends a ping as soon as the webhook is saved.
        </p>
      </div>
    );
  const outcome = OUTCOMES[delivery.status];
  const at = new Date(delivery.at);
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3.5" data-testid="github-last-delivery">
      <p role="status" className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          data-color={outcome.color}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs',
            outcome.color
              ? 'bg-tint text-tint-accent'
              : 'bg-foreground/[0.08] text-muted-foreground',
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {outcome.label}
        </span>{' '}
        <span className="font-medium font-mono text-sm">{delivery.event ?? 'delivery'}</span>
        <span className="sr-only"> · </span>
        <time dateTime={delivery.at} className="text-muted-foreground text-sm">
          {when.format(at)}
        </time>
      </p>
      {delivery.detail && (
        <p
          className={cn(
            'break-words text-sm',
            delivery.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {delivery.detail}
        </p>
      )}
      {delivery.id && (
        <p className="break-all font-mono text-[0.6875rem] text-muted-foreground/80">
          {delivery.id}
        </p>
      )}
    </div>
  );
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const [turns, setTurns] = useState(0);
  const reduced = useReducedMotion();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="-my-2 size-11 shrink-0 rounded-full"
      aria-label="Check for new deliveries"
      onClick={() => {
        haptics.toggle();
        setTurns((count) => count + 1);
        onRefresh();
      }}
    >
      <motion.span
        className="flex"
        animate={{ rotate: reduced ? 0 : turns * 360 }}
        transition={springs.smooth}
      >
        <RefreshCw aria-hidden />
      </motion.span>
    </Button>
  );
}

type Surface = 'edit' | 'secret' | 'url' | 'disconnect';

function Connected({
  connection,
  statuses,
}: {
  connection: GithubConnection;
  statuses: readonly Status[] | null;
}) {
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
          icon={FolderGit2}
          label={
            <a
              href={`https://github.com/${connection.repository}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              <span className="break-all">{connection.repository}</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          }
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
            connection.enabled
              ? 'Tasks follow GitHub’s changes'
              : 'Deliveries are recorded and ignored'
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
        <p role="alert" className="-mt-3 px-4 text-destructive text-sm">
          {error}
        </p>
      )}

      <SettingsSection title="Last delivery" action={<RefreshButton onRefresh={refresh} />}>
        <LastDelivery delivery={connection.lastDelivery} />
      </SettingsSection>

      <GithubStatusRules connection={connection} statuses={statuses} />

      <SettingsSection
        title="Webhook"
        description="The values of the webhook on GitHub. Throw ignores events it does not use."
      >
        <div className="flex flex-col gap-4 p-4">
          <CopyField label="Payload URL" value={connection.webhookUrl} />
          <CopyField label="Content type" value={CONTENT_TYPE} />
        </div>
        <SettingsRow label="Secret" description="Shown once, when it was made">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 shrink-0"
            onClick={() => setSurface('secret')}
          >
            New secret
          </Button>
        </SettingsRow>
        <SettingsRow label="Address" description="Retires the URL above">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 shrink-0"
            onClick={() => setSurface('url')}
          >
            New URL
          </Button>
        </SettingsRow>
      </SettingsSection>

      <div className="rounded-2xl bg-foreground/[0.05]">
        <button
          type="button"
          onClick={() => setSurface('disconnect')}
          className="flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 font-medium text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <Unplug className="size-4" aria-hidden />
          Disconnect GitHub
        </button>
      </div>

      {surface === 'edit' && <EditConnection connection={connection} onClose={close} />}
      {surface === 'secret' && (
        <Confirm
          title="Make a new secret?"
          body="GitHub’s deliveries are refused until you paste the new secret into the webhook on GitHub."
          action="Make new secret"
          busyAction="Making…"
          onConfirm={async () => {
            const rotated = await api.rotateGithubSecret(connection.projectId);
            close();
            settings.showSecret(rotated, true);
          }}
          onClose={close}
        />
      )}
      {surface === 'url' && (
        <Confirm
          title="Move the webhook to a new URL?"
          body="The current URL stops answering at once. Paste the new one into the webhook on GitHub."
          action="Make new URL"
          busyAction="Making…"
          onConfirm={async () => {
            settings.changed((await api.rotateGithubUrl(connection.projectId)).connection);
            haptics.success();
            close();
          }}
          onClose={close}
        />
      )}
      {surface === 'disconnect' && (
        <Confirm
          title={`Disconnect ${connection.repository}?`}
          body={`Throw forgets the secret${connection.hasToken ? ' and the access token' : ''}${connection.statusRules ? ' and the status rules' : ''}, and the webhook URL stops answering. Delete the webhook on GitHub as well.`}
          action="Disconnect"
          busyAction="Disconnecting…"
          destructive
          onConfirm={async () => {
            await api.deleteGithubConnection(connection.projectId);
            haptics.warning();
            settings.removed();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

function Confirm({
  title,
  body,
  action,
  busyAction,
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  action: string;
  busyAction: string;
  destructive?: boolean;
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
      <div className="flex flex-col gap-5 pb-1">
        <p className="text-muted-foreground text-sm">{body}</p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
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
            {busy ? busyAction : action}
          </Button>
        </div>
      </div>
    </ManagementSurface>
  );
}
