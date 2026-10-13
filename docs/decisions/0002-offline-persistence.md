# 0002: Offline persistence and the outbox

Status: accepted (2026-10-13)

## Context

The app has to show and change its data without a connection, on the web and later on
Android. Catch solved this; Throw takes the same approach.

## Decisions

**Each user's synced data is kept in SQLite on the device.** Collections persist to a
database per user (`lib/localStore.ts`): SQLite compiled to WebAssembly on OPFS in the
browser, and the Capacitor SQLite plugin on Android. Electric identifies a shape by its URL
alone and every user syncs the same URLs, so users never share a database. Without a
database (private browsing, an old browser) the app still works online, in memory.

**Writes go through an outbox.** `write()` applies a change to the collections at once and
stores it in IndexedDB before sending it. The outbox sends writes in order and retries
until the server has them. A write is dropped only when it can never succeed (the server
refused it, or the row was deleted elsewhere), and the user is told. Losing a connection,
a session or protocol compatibility pauses the outbox; it never discards it.

**Writes are safe to replay.** A write can reach the server and lose its response, so the
outbox may send it again. Creates and deletes that were already applied answer
`{ txid: null }`.

**The optimistic copy hands over on the transaction id.** A write route returns the id of
its Postgres transaction, and the client keeps the optimistic row until Electric streams
that transaction back.

**One tab keeps the outbox.** Tabs elect a leader with Web Locks. Other tabs send their
writes straight away and need a connection.

**Signing in or out is a full page load.** Collections open the user's database when their
module loads, so a page never holds two users' data. Signing out deletes the device's copy
and its outbox, after a warning when changes are still unsent.

**A collection has a `schemaVersion`.** Changing the columns a shape syncs bumps it, and
devices drop and resync that collection.

## Consequences

- Offline, a collection never becomes "ready", because that needs the server. Pages decide
  what to show with `useAwaitingSync`.
- The outbox's format is device data. Changing what a queued write looks like needs a
  migration that keeps queued writes.
- The dev server has no service worker, so offline tests block `/api` instead.
