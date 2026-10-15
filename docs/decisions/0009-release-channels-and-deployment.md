# 0009: Release channels and independent deployment

Status: accepted (2026-10-15, owner decision)

Throw ports Catch's ADR 0009 pipeline: explicit stable/preview tags, unpublished dev builds,
GHCR multi-platform server images containing the web build, signed APKs/checksums on GitHub
Releases, exact-commit CI gates, manual tagging and exact-commit preview promotion. There
is no marketing site or deployment workflow. API compatibility stays separate (ADR 0003).

The owner chose public distribution from `iiloni/throw` and an operator-owned deployment
directory. Throw maintains a combined example, not a canonical owner deployment or a third
repository. Operators copy/review infrastructure separately from independently pinned app
images. One Postgres 17 container can serve both separate databases, each with its own
server, Electric/stream ID/storage, accounts and backups. Either app can run alone through
Compose profiles. No Catch file/repository is modified or required at build time.

Differences from Catch: Throw uses its own signing key, artifact/package IDs and workflow
queues; Android version codes allocate 1,000,000,000 plus Throw's release run number
(1–99,999,999). Throw retains its existing channel artwork without Catch's icon picker.
The combined example uses non-superuser database owners with CREATEDB and REPLICATION,
rather than handing either app cluster-superuser credentials. Shared replication resources
and availability remain a trust boundary; separate stacks provide stronger isolation.

Update/backup helpers target one configurable app service, so updating Throw cannot recreate
Catch or shared Postgres. Restore/rollback instructions must operate on Throw's database
and Electric storage, never remove the shared cluster volume. Production instances migrate
at startup and are backed up before doing so (ADR 0010).

Web prompts use uncached build IDs and a durable-write barrier before explicit worker
activation/reload. Native updates target the server's exact newer version in the same
channel and verify checksum, package, increasing code and certificate before installation.
Version discovery is a stable authenticated bootstrap route outside the data-protocol gate.
Prompts preserve offline data and allow working offline when a client update is required.
