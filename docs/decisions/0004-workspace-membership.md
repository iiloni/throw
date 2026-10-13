# 0004: Rows belong to workspaces, reached through membership

Status: accepted (2026-10-13)

## Context

The first version of Throw is used by one person, but sharing a workspace or a project is
expected later (docs/spec.md). In Catch every row carries a `user_id`, and both queries and
Electric shapes filter on it. Adding sharing to that model means rewriting every table and
filter.

## Decisions

**Rows hang off a workspace, not a user.** `workspaces` has no owner column. A
`workspace_members` row (workspace, user, role) says who may see a workspace and everything
in it. `projects` has a `workspace_id`; tables added later carry one too, or a parent that
does.

**Every account starts with one workspace.** Signing up creates a "Personal" workspace with
the new user as its owner, so there is always somewhere to put a first project. Creating a
workspace makes its creator the owner in the same transaction.

**The server checks membership on every query.** Reads and writes filter by the signed-in
user's workspaces (`memberWorkspaces`). An id in a request is never trusted on its own: a
row in someone else's workspace answers as if it did not exist.

**Shapes filter with a subquery.** The shape proxy pins each shape to
`workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)` and an
explicit column list. Electric keeps such a shape current when membership changes, moving
rows in and out, so rows need no copy of a user id.

**Roles exist but do nothing yet.** A member is `owner` or `member`. Until sharing is
built, every member is an owner and no route distinguishes them.

## Consequences

- Sharing can be added by inserting membership rows; no table changes shape.
- A user's local database holds every workspace they belong to. Leaving a workspace removes
  its rows from their device through the shape.
- The membership table itself is not synced to clients yet. A client that needs to show
  members will need a shape for it.
- Whether a future member joins a whole workspace, one project, or either is still open
  (docs/spec.md). Project-level membership would need a second filter.
