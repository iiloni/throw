# 0018: Server user administration and invite links

Status: accepted

The first account becomes admin. By default later accounts need a seven-day, single-use
invite. Operators can set `REGISTRATION=open` for public registration or `closed` to
refuse subsequent accounts even with an invite. Dev stacks run open. A supplied token
must be valid in open mode too. Signup serializes the bootstrap decision, claims the
invite, creates the credential, session and personal workspace and records the new user
in one database transaction. A failed signup leaves the invite available.

Admins issue and revoke invites under `/api/admin/invites`. Creation returns a random
token once. The login link puts it in the fragment and clients send it in
`X-Throw-Invite` at signup. The database stores its SHA-256 hash. A label is for the
admin's reference. At most 100 invites are usable at once. Deleting an invite revokes
the link and preserves the account it made. Backups retain invite hashes, expiry times
and claim history. Restoring an archive can therefore reactivate a link revoked or used
after the backup if its original expiry is still in the future.

The server-wide user directory exposes id, name, email, role, creation and last login.
All admin requests check the actor's live role, including backup download tickets.
Role edits, password resets and deletion serialize and check the actor again under lock.
Admins cannot perform these three actions on themselves. A reset replaces the credential
hash and revokes every target session atomically. The temporary password is returned once
with caching disabled and remains valid until changed.

Account deletion locks its workspaces and removes each one left without members.
Their projects, statuses, tasks, tags, relations, comments, history, webhooks, deliveries
and GitHub data cascade with them. Workspaces with other members retain their contents
and existing membership roles. In surviving workspaces comments, task activity,
structure and comment history and GitHub connections keep nullable author/creator
references. The account's credentials, sessions, memberships, MCP tokens (and replay
records), owned webhooks (and deliveries) and issued invites cascade. Other admins'
invites claimed by the deleted account stay used with a null recipient.

These online REST endpoints are outside sync and the outbox. Protocol 1 advertises the
additive `adminUsers` capability on `/api/compatibility`. Clients can hide these controls
when it is absent. Older clients keep their existing signup flow on open servers and can
sign in to accounts already created. The backup download ticket route remains before
the protocol gate (ADR 0011).
