# Server backups

Admins can make, download, upload, restore and schedule whole-server backups in Settings >
Server backups. The first account is the server administrator. Workspace ownership does
not confer server administration. Every backup route checks the server role; downloads use
short-lived signed tickets checked against the current admin role.

The port follows Catch's ADR 0012, with no attachment path because Throw has no attachments.
See [ADR 0010](decisions/0010-server-backups.md). The entire database is covered, including
accounts, workspaces, projects, statuses, tasks, subtasks, counters, tags and activity tables
when present. No allowlist of application tables needs updating for new features.

## Format and storage

`throw-backup-<UTC date>_<time>-<kind>.zip` contains `database.dump` (Postgres custom format)
and `manifest.json` (format/version, creating release, newest migration, display counts,
secret fingerprint and SHA-256/size of every file). ZIP64 and streaming avoid memory/4 GiB
limits. Verification rejects unexpected members, damaged checksums, and Catch archives.
Any unzip tool can read it; `pg_restore` can read the dump independently of Throw.
Sessions are excluded, including when restoring an older dump that contains them.

Backups are **not encrypted** and include password hashes and everyone's data. Files are
owner-only. Keep credentials and backup copies securely off the server and test restores.
The `.env`, TLS/proxy configuration and `schedule.json` are not part of the database dump.

| Kind | Trigger | Retention |
| --- | --- | --- |
| `manual` | App or host CLI | Until deleted |
| `scheduled` | Daily local time + IANA zone; catches up after downtime | 7 by default; configurable 1–365 |
| `update` | Before a new release or pending migrations | `UPDATE_BACKUPS_KEPT`, default 10 |
| `pre-restore` | Just before replacing live data | 3 |
| `upload` | Verified imported archive | Until deleted |

Retention is independent per kind. Manual backups cannot be evicted by the daily schedule.
Schedules live beside backups and survive database restore. A failed scheduled attempt is
reported and retried the following day, rather than every minute. Only one app process may
manage a given backup directory; host CLI operations must not overlap app backup/restore jobs.

Standalone Compose mounts `backup_data` at `/data/backups`. Set `THROW_BACKUPS_MOUNT` to an
existing directory on another disk, writable by the container's node user (UID 1000), to
survive losing the database disk. The settings page conservatively says that disk isolation
must be verified by the operator: the app cannot inspect a remote Postgres server's disk.
Without a mount, backups die with the container and the page warns. The CLI refuses creating
such ephemeral backups unless explicitly told `--allow-ephemeral`.

```dotenv
THROW_BACKUPS_MOUNT=/mnt/backups/throw
```

Copy completed archives elsewhere with rsync/restic or another operator-managed tool;
exclude `.tmp/`. Scheduled backups and download copies are the path to off-server retention.

## Updating and recovery

Before startup migrations, the server creates an update backup when migrations are pending
or the recorded release changed. Failure prevents migration/startup. `UPDATE_BACKUPS=false`
is an explicit opt-out. `POSTGRES_MAJOR=17` in the Dockerfile tracks Compose's Postgres major:
changing Postgres requires matching client tools. Image rollback alone cannot undo migrations.

Copy `scripts/backup.sh` and `scripts/update.sh` next to the deployment's Compose file; both
also work from the checkout. Set `THROW_COMPOSE_DIR` if it is elsewhere. For the combined
stack, pass `THROW_APP_SERVICE=throw`; standalone defaults to `app`.

```bash
./backup.sh create
./backup.sh list
./backup.sh inspect <backup-name>
./backup.sh export <backup-name> [destination.zip]
./backup.sh import <file.zip>
./backup.sh restore <backup-name-or-file.zip>   # confirmation required; -y for automation
./backup.sh prune --kind manual --keep 5
./update.sh                                  # backup first, pull/recreate only this app
./update.sh --skip-backup                     # explicit recovery opt-out
# Combined deployment:
THROW_APP_SERVICE=throw ./backup.sh create
THROW_APP_SERVICE=throw ./update.sh
```

The helper backs up with the old image before replacing it; startup recognizes a fresh
update backup and avoids duplicating it. Helpers update/restart only the chosen application;
shared Postgres and Catch remain running. Start new deployments/dependencies with Compose
as documented in [Deployment](deployment.md), rather than with the update helper.

An in-app restore verifies the archive, refuses unknown future migrations or a live schema
ahead of the running code, and first makes a pre-restore safety backup. It loads/migrates the
dump into a scratch database, then truncates/refills live tables in one transaction. The
tables and their Electric publication identity survive; truncation invalidates shapes so
devices refetch. A failure before commit leaves live data unchanged. The server answers API
requests with 503/Retry-After while restoring, except health, and the outbox retries later.
All users' state is rolled back. Queued device writes can apply after restore. The initiating
admin's session is put back if that account exists; others sign in again.

The database role needs `CREATEDB` and table ownership. A superuser connection creates a
restricted temporary role to load untrusted uploaded SQL. A role with dangerous host-file,
program-execution or role-creation privileges but without superuser is refused. The combined
example uses plain CREATEDB/REPLICATION owners and withholds cluster administration credentials.
Replicating apps still share a trusted cluster; use separate stacks for stronger isolation.

The host restore stops only the app and runs the shipped CLI in a one-off container, so it
also works when the server cannot boot. Back up the `.env` separately and preserve
`BETTER_AUTH_SECRET` when moving servers. Start the same/newer image on the new server,
import/restore a backup, then sign in. A different secret invalidates prior signed sessions.

### Going back after a bad update

Prefer restoring a pre-update backup with the current image, allowing its migrations to
run forward. To return to an older image, give it an empty **Throw database**, because an
older image cannot safely restore into a newer schema.

In a standalone Throw stack, stop it and remove only that project's Postgres and Electric
volumes after exporting backups elsewhere; keep its backup volume. Confirm actual names
with `docker compose config --volumes` and `docker volume inspect`. Pin the old image,
start it on the empty database, and restore the pre-update archive.

**Never delete the shared Postgres volume in the combined deployment.** Stop `throw` and
`throw-electric`, keep Catch running, and use the cluster administrator to drop/recreate
only the `throw` database with owner `throw`. Inspect `pg_replication_slots` and drop only
inactive Throw slots (`database = 'throw'`) if needed. Remove only the combined project's
`throw_electric` volume, pin the older Throw image, start those two services, then run
`THROW_APP_SERVICE=throw ./backup.sh restore <pre-update-archive>`. Retain the backup volume
and all Catch volumes. Database/volume deletion is destructive: verify exports and targets
before performing it.

Development uses `./scripts/dev.sh backup <command>` against the worktree's database and
ignored `.backups/`. Dev disables automatic pre-update backups; production does not.
