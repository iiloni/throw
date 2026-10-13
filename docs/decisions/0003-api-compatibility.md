# 0003: API compatibility

Status: accepted (2026-10-13)

## Context

A self-hosted server and its clients update at different times: an installed PWA or an
Android app can be older or newer than the server it reaches. A client that sends a write
in a format the server no longer understands, or reads rows of a shape it does not expect,
loses or corrupts data. Throw takes Catch's protocol gate.

## Decisions

**Clients state a protocol version and the server states a range.** Every data request
carries `X-Throw-Protocol`. The server answers 426 with its supported range when the
version is outside it. `GET /api/compatibility` returns the range without a header, so a
client can check before sending anything.

**Bootstrap requests are never gated.** Health, compatibility and auth routes work for any
client, so an incompatible one can still tell the user what to update.

**An incompatible client waits.** Its writes stay in the outbox and its shapes stay idle
until one side is updated. A protocol rejection is never treated as a permanent failure of
a write, and local data is never cleared to recover.

**The version changes only for incompatible contracts.** UI changes, compatible fixes and
additions with a fallback leave it alone.

**Until the first release the protocol is 1.** Nothing is deployed, so contracts may change
without a bump. From the first release on, an incompatible change raises the client version
and the server's maximum, with tests at the boundaries and a documented upgrade order.

## Consequences

- New data routes are gated by default; a new exemption is a decision to record here.
- Shared TypeScript types check one build against itself. A contract change still needs
  thinking through old client with new server, and new client with old server.
