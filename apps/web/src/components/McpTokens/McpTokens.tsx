import { createMcpTokenSchema, type McpToken, type McpTokensResponse } from '@throw/shared';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { type FormEvent, useContext, useId, useRef, useState } from 'react';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { McpSettingsContext } from '@/lib/mcpSettings';
import { getServerUrl } from '@/lib/serverUrl';

export function McpTokens() {
  const settings = useContext(McpSettingsContext);
  if (!settings) return null;
  const { state, retry, added, removed } = settings;
  if (state.status === 'ready')
    return <TokenList inventory={state.inventory} onCreate={added} onRevoke={removed} />;
  return (
    <SettingsSection title="MCP tokens">
      {state.status === 'loading' ? (
        <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
          Loading MCP tokens…
        </p>
      ) : state.status === 'unavailable' ? (
        <SettingsRow label="MCP tokens require a newer Throw server" />
      ) : (
        <SettingsRow
          label="Could not load MCP tokens"
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

function TokenList({
  inventory,
  onCreate,
  onRevoke,
}: {
  inventory: McpTokensResponse;
  onCreate: (token: McpToken) => void;
  onRevoke: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<McpToken | null>(null);
  const endpoint = `${getServerUrl()}/api/mcp`;
  const workspaceNames = new Map(inventory.workspaces.map(({ id, name }) => [id, name]));

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Workspace access"
        description="A token lets an external client read and change tasks in one workspace."
      >
        {inventory.tokens.map((token) => (
          <SettingsRow
            key={token.id}
            icon={KeyRound}
            label={<span className="break-all">{token.name}</span>}
            description={workspaceNames.get(token.workspaceId) ?? 'Workspace access ended'}
          >
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 shrink-0"
              aria-label={`Revoke ${token.name}`}
              onClick={() => setRevoking(token)}
            >
              Revoke
            </Button>
          </SettingsRow>
        ))}
        {inventory.tokens.length === 0 && <SettingsRow label="No MCP tokens" />}
        {inventory.workspaces.length > 0 && (
          <div className="px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-0"
              onClick={() => setCreating(true)}
            >
              <Plus aria-hidden /> Create token
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Connect a client"
        description="Use Streamable HTTP and send your token as a bearer credential."
      >
        <p className="select-all break-all px-4 py-3 font-mono text-sm">{endpoint}</p>
      </SettingsSection>

      {creating && (
        <CreateToken
          workspaces={inventory.workspaces}
          onCreate={onCreate}
          onClose={() => setCreating(false)}
        />
      )}
      {revoking && (
        <RevokeToken token={revoking} onRevoke={onRevoke} onClose={() => setRevoking(null)} />
      )}
    </div>
  );
}

function CreateToken({
  workspaces,
  onCreate,
  onClose,
}: {
  workspaces: McpTokensResponse['workspaces'];
  onCreate: (token: McpToken) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const nameId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const secretField = useRef<HTMLInputElement>(null);
  const close = () => {
    if (!busy) onClose();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || token) return;
    const body = createMcpTokenSchema.safeParse({ name, workspaceId });
    if (!body.success) {
      setError('Enter a token name and choose a workspace.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.createMcpToken(body.data);
      onCreate(created.metadata);
      setToken(created.token);
    } catch {
      setError('Could not create the token. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      secretField.current?.focus();
      secretField.current?.select();
    }
  }

  return (
    <ManagementSurface
      open
      title={token ? 'Copy your token' : 'Create MCP token'}
      onClose={close}
      initialFocusRef={token ? undefined : nameField}
      fit
    >
      {token ? (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="text-muted-foreground text-sm">
            Copy this token now. Throw only shows it once.
          </p>
          <Input
            ref={secretField}
            readOnly
            value={token}
            className="font-mono"
            aria-label="MCP token"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              <Copy aria-hidden /> {copied ? 'Copied' : 'Copy token'}
            </Button>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4">
          <label htmlFor={nameId} className="flex flex-col gap-2 text-sm font-medium">
            Token name
            <Input
              id={nameId}
              ref={nameField}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              placeholder="For example, code agent"
              maxLength={80}
              required
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Workspace
            <select
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring"
              required
              disabled={busy}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create token'}
            </Button>
          </div>
        </form>
      )}
    </ManagementSurface>
  );
}

function RevokeToken({
  token,
  onRevoke,
  onClose,
}: {
  token: McpToken;
  onRevoke: (id: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.revokeMcpToken(token.id);
      onRevoke(token.id);
      onClose();
    } catch {
      setError('Could not revoke the token. Try again.');
      setBusy(false);
    }
  }

  return (
    <ManagementSurface open title="Revoke MCP token" onClose={close} fit>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="break-words text-muted-foreground text-sm">
          Clients using “{token.name}” will lose access on their next request.
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
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void revoke()}>
            {busy ? 'Revoking…' : 'Revoke token'}
          </Button>
        </div>
      </div>
    </ManagementSurface>
  );
}
