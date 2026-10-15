# 0010: Whole-server backups and restore

Status: accepted (2026-10-15)

Port Catch ADR 0012's design: streaming ZIP64 archives of a custom-format Postgres dump
plus a checksummed manifest, scheduled/manual/update/pre-restore/upload kinds with separate
retention, admin-only settings/API, expiring download tickets, and a shipped CLI for recovery.
Schedules live beside backups, not in the database. Sessions are excluded; the in-app
initiating admin's session is retained if their account survives the restore.

Restore validates first, loads/migrates a scratch database, then truncates/refills existing
live tables atomically. Their Electric identities survive and truncation causes refetch.
API requests pause with 503/Retry-After except health; queued writes retry. Uploaded SQL is
loaded without superuser host access. A live schema or archive from unknown newer migrations
is refused. A pre-restore backup protects the current data.

Startup backs up before pending migrations or release changes and fails closed when that
backup fails, unless explicitly opted out. PostgreSQL 17 client tools ship in both dev and
production images. Host helpers use the same CLI and target a single application service.

Throw differs only where its model requires it: no attachments/media previews, archive
format `throw-backup` with database + manifest only, and users/tasks display counts. It
cannot restore Catch archives. The app cannot determine the storage device of remote
Postgres, so it conservatively asks operators to verify disk separation rather than claim
that a mount survives disk failure. Backups are unencrypted and require off-server copies.
Only one app process manages a directory; host operations must not overlap its jobs.

No synced tables, queued-write formats, collection schemas or protocol constants change.
The server admin role already exists. New backup routes are protocol-gated; plain download
links instead require an expiring signed ticket and a current server-admin check. That one
read-only route is mounted before the gate because a browser download cannot send headers.
