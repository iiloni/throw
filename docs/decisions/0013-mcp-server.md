# 0013 — MCP access to Throw

Status: accepted (2026-11-20)

## Context

An agent can use a Throw project as its work queue. It reads the project's statuses,
creates a task per item, links PRs in descriptions, posts progress in comments and adds
subtasks for stacked work. The owner follows and manages that work on the same board as
their device edits.

## Opt-in and credentials

MCP is Throw's first opt-in integration. The account holder starts work in an external
agent and gives it a credential that acts under their authority. Throw starts with no
usable MCP credentials. Changes carry the credential's name back to the task, and Throw
runs no scheduled agent jobs or task rules.

**Each token grants read and task-write access to one workspace.** This is the scope of a
Throw board and keeps a client working on one queue from reaching unrelated work. A client
that needs another workspace uses another token. `list_workspaces` returns the one
workspace the credential can reach. Every MCP query intersects the token's scope with
the owner's current `memberWorkspaces` membership, even for lookups by UUID. Removal from
the workspace ends access. An inaccessible resource is treated as missing. A server
admin's token has the same workspace and tool limits as any other token.

**Manage credentials in Settings.** `/settings/mcp` uses `SettingsLayout` and
`ManagementSurface` for creation and revocation on both layouts. A signed-in user names
the token, selects a workspace they belong to and sees the secret once. They can list
and revoke their own tokens, including tokens for workspaces they have since left. Tokens
last until revoked. Revocation takes effect on the next request and a request already
authorized can finish. Deleting the account or workspace removes its credentials.

**Own a small server-only table.** Store the owner, workspace, display name, creation time,
token ID and a unique SHA-256 digest. Generate a token with the `throw_mcp_` prefix followed by
32 cryptographically random bytes encoded as base64url. A request presents the secret
only in `Authorization: Bearer …`. The MCP verifier only handles this token format and
checks the table on each request. Never return the digest or sync token rows. The Settings
API reads metadata and returns the raw token only in the uncached creation response.

Better Auth's API-key plugin has hashed keys and rate limiting, and can verify keys with
session creation disabled. Throw needs one mandatory workspace scope and a credential
lifecycle owned by Settings and the backup code. A dedicated table and verifier keep
those rules and the key-management surface together. Better Auth continues to handle app
sessions with `bearer({ requireSignature: true })`. App sessions and cookies do not
authenticate to `/api/mcp`, and MCP tokens cannot open an app session or authorize REST,
shapes or token management. OAuth discovery and consent through Better Auth's MCP and
OAuth/OIDC provider are a possible follow-up. Version one requires a client that can
send a configured bearer token. [API-key plugin reference](https://better-auth.com/docs/plugins/api-key/reference),
[Better Auth MCP provider](https://better-auth.com/docs/plugins/mcp).

## Transport and compatibility

Mount Streamable HTTP at `/api/mcp` on the existing Hono server, using the official
TypeScript SDK `@modelcontextprotocol/sdk` pinned to `1.32.2`. Use the Web-standard
transport with a fresh server and transport per request and JSON replies to POST. The
tool catalog is fixed and calls are short and independent, so there is no MCP session ID,
server push or stream resumption. Authenticated GET and DELETE return 405. Electric
delivers task changes to Throw devices as it does for writes made in the app.
[Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[TypeScript SDK release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2).

Mount this route outside the app session middleware and [ADR 0003](0003-api-compatibility.md)'s
`X-Throw-Protocol` gate, under the existing server restore guard. The SDK handles MCP
version negotiation. Token management uses the signed app session and the Throw protocol
gate. Both surfaces use shared Zod input and output schemas. Throw's protocol stays at 1
before the first release. Existing app clients can ignore the new attribution columns.
New app clients must tolerate absent attribution on an older server and hide token
management when the server lacks its API. Queued app writes keep their existing format.

## Tools

Tool descriptions tell the agent what the tool changes, which identifiers to supply and
how to handle refusals. Responses use structured data with bounded pages and continuation
cursors for lists and task detail sections. Reads return task UUIDs and current human-readable
keys such as `THR-12`. Tools accept either for a task reference, resolved only in the
token's workspace. Use the UUID for stored links and repeat lookups that must survive
project key changes. Key resolution follows [ADR 0007](0007-task-identifiers.md).

| Tool | Purpose |
| --- | --- |
| `list_workspaces` | Identify the token's workspace. |
| `list_projects` | Find projects and their current keys. |
| `list_statuses` | List a project's statuses, categories and defaults. |
| `list_tags` | List a project's tags with IDs and paths. |
| `list_tasks` | List tasks or search their titles, descriptions and current keys. Filter by project, status or category, priority, tag, parent and trash state. Exclude effectively trashed tasks by default. |
| `get_task` | Read a task and its subtasks, comments and history, with cursors for those sections. |
| `create_task` | Create a task in a project or create a subtask by supplying its parent. |
| `update_task` | Edit the title, description or priority, or trash or restore the task. |
| `move_task` | Change status or place a task relative to an existing neighbor in the destination lane. The server computes the position with the existing fractional ordering. |
| `add_comment` | Post a comment on a task. |
| `set_task_tags` | Set or clear the primary tag and add or remove individual secondary tags. |

Users configure projects, statuses and tags in Throw. The tools can assign existing
statuses and tags. Permanent removal and task relations such as `blocks` and `depends on`
are outside this tool surface.

## Shared writes and conflicts

Extract the existing task create, task update and comment create bodies into shared server
functions. REST handlers validate app input and map the function result to the existing HTTP
response. MCP handlers validate tool arguments, translate them to the same write inputs and
call those functions directly. The functions keep the existing transactions, locks, task
number allocation, parent/status/tag validation, membership checks and activity writes. The
authenticated actor supplies `userId` and, for a token, its workspace constraint and name.
The workspace restriction belongs in the shared write queries as well as MCP reference lookups.

Under [ADR 0005](0005-offline-conflicts.md), an agent provides the before values it read for
the fields it wants to change. For descriptions it provides the returned description
version token. A move carries the observed task scope and uses a neighbor in the target
scope, checked when calculating the position in the write transaction. Position still
applies only in its computed status, priority and parent. Tag updates keep the primary's
before value and the existing independent secondary operations. Trash and restore compare
the task's own trash state. The result identifies applied and refused fields, including
placement failures, so the agent can read again before retrying a stale change. Creates
report any status or tag fallback the shared logic applied.

Use UUIDv7 for creates, comment IDs, change IDs and description versions. The adapter
can generate IDs, and a caller can supply a stable operation UUIDv7 to make retries of
the same write reuse the existing replay identity. Operation IDs are scoped to the
credential. A JSON-RPC request ID is independent of write replay. The committed rows go to Electric through the usual shapes. MCP clients get
the resulting task or comment reference and the write outcome. REST clients keep the
transaction responses their outbox uses for handover.

## Text content

Accept and return Markdown for descriptions and comments. A lightweight server-side
Markdown parser and serializer map to Throw's text-only BlockNote JSON. Use an AST to
preserve paragraphs, headings, nested ordered and unordered lists, links, fenced and
inline code, quotes, dividers, and emphasis. Raw HTML, images and embeds are rejected on input. Permit
HTTP(S) and mailto link destinations. Reads never fetch a link. For existing content
outside the supported subset, return readable Markdown and identify any formatting or
blocks the conversion cannot represent faithfully. Include that indication with the
description version so a caller can avoid a lossy read-edit-write. A supplied description
replaces the document, and omission preserves it. The server carries no BlockNote editor
or DOM runtime.

## Attribution

Add nullable `viaTokenName` columns to `task_activity` and `comments`. A shared write
stamps the authenticated user's ID as before and snapshots the display name server-side
in the same transaction. The name remains readable after revocation, and neither table
stores token secrets or hashes. Refused task changes use the same attribution. For a
successful agent reorder that changes only position, write a visible history item
described as “Reordered”. Device-only reorders retain their existing replay-only entry.
A comment appears in Comments, with the token name on the comment itself.

Add attribution to the existing shape allowlists and bump both collections' `schemaVersion`.
`TaskDetails/TaskTimeline.tsx` shows “via <token name>” in History and on agent comments.
Historical and ordinary app rows can have no attribution. The two existing tabs and the
offline timeline continue to use the same activity and comment shapes.

## Security and operation

- Authenticate before decoding tool arguments. Return 401 for a missing, invalid or
  revoked credential. Cap request bodies at Throw's existing 1 MiB JSON limit, including
  chunked bodies, before parsing. Accept one MCP message per POST and bound page sizes
  and Markdown parsing work.
- Allow 240 requests per minute per connection-derived client IP before token lookup and
  120 per minute per token ID after authentication. Reuse Throw's trusted-proxy IP handling. Use bounded, expiring
  counters in the supported single-server deployment and return 429 with `Retry-After`.
  Client IP limits also cover failed authentication. Multiple instances would need shared
  limits or equivalent enforcement at the proxy.
- Give `/api/mcp` its own boundary before the application's CORS middleware. Version one
  serves clients outside the browser, without CORS or cookie credentials. Check the Host
  against the configured public authority and reject a present `Origin` other than the
  configured server origin with 403. Preserve `lib/securityHeaders.ts`'s API CSP and the
  app's existing CSP. Send `Cache-Control: no-store` and keep credentials and tool bodies
  out of logs.
- Follow the session-credential precedent in ADR 0011. Exclude token data from backups
  and clear the token table on restore, including when an imported archive contains it.
  A restore must not revive a revoked token. History and comments retain their attribution.

The [deployment guide](../deployment.md#connect-an-mcp-client) covers enabling access,
client setup, proxy controls and rotation after restore.
