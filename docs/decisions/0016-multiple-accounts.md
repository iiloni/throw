# 0016: Several accounts on one device

Status: accepted (2026-11-25)

## Context

A device held one session. Someone with two accounts on a server (their own and a shared
team one, say) had to sign out to reach the other, and signing out deletes that account's
copy of its data and any change that has not synced (ADR 0002). Catch solved the same
problem in its ADR 0019; Throw ports that design, without Catch's reminders, push
subscriptions, attachments or link capture, which Throw does not have.

## Decisions

**The device keeps a list of sessions.** `lib/auth.ts` stores every signed-in account's user
and bearer token under `throw-accounts`. The session in use stays under the keys it always had
(`throw-auth-token`, `throw-user`), so a session from an older build is simply the list's first
entry, and an older build still finds its session after a downgrade. Signing in adds to the
list and makes the new account the one in use; signing in again as a listed account replaces
its token. The server is not involved: each account has an ordinary Better Auth session, and
no request, response or shape changes.

**Switching is a full page load.** Collections open one user's database when the module loads
(ADR 0002), so `switchAccount` in `lib/accounts.ts` changes the session in use and loads the
app again, as signing in does. Each account already had its own database (`throw-<id>`),
outbox (`throw-outbox-<id>`, with its Web Locks leader of the same name) and per-user state on
the device: remembered navigation (`throw-navigation-<id>`), description and comment drafts
and dismissed refusal notices, all keyed by user id. The other accounts' stay untouched.

**A tab shows one account, and tabs can show different ones.** A tab remembers its account in
`sessionStorage` (`throw-tab-account`), so it keeps it across reloads while another tab
switches. The session in use on the device is only where a new tab starts: the account last
switched to or signed in. Two tabs on two accounts sync side by side; two tabs on one account
share its database and outbox leader as before. The Android app is one tab.

**The address says whose page it is.** While several accounts are signed in, a browser's
addresses start with the account's number on the device: `/u/2/w/<id>/p/<id>`,
`/u/2/settings/account`. So a bookmark, a copied address or a link opened in a new tab leads to
the same account's page, whatever the tab or the device was last showing. `lib/auth.ts` reads
the number when the page loads, before anything asks whose page it is, and the router takes
any number off the addresses it reads and puts the page's on those it writes
(`routerRewrite`, passed to `createRouter` in `main.tsx`), so routes and links never mention
it. Only a full page load to another account has to: `accountPath` builds its address, and
`pagePath` that of a plain `<a href>` within this one (the desktop rail's links, which a
middle-click opens in a new tab).

- Numbers are per device, from 1, given in the order accounts first signed in here
  (`throw-account-numbers`). A number is kept after a sign-out, so an account that signs in
  again gets the number its bookmarks name and its old place in the list.
- `reorderAccounts` puts the accounts in order and renumbers their addresses after it, as
  Catch's does; a signed-out account keeps its number unless one signed in took it. Open tabs
  follow their account to its new number without loading (`followAccountNumber`, on the
  storage event in other tabs). The switcher that calls it is not built yet.
- An address with no number means the tab's account, or for a new tab the one last used. It
  gains the number when the page loads with several accounts or when another tab adds the
  second account. With one account,
  addresses stay as they were: there is nobody to tell apart, and an existing bookmark or the
  installed app's start address needs no number.
- An address whose number belongs to nobody signed in goes to the sign-in page, keeping the
  page asked for. Whoever signs in is taken to that page as themselves.
- The Android app has no address bar and keeps its addresses without numbers.

**A page belongs to the account it loaded for.** `getAuthToken` and `getSignedInUser` answer
for that account until the page loads again, whatever the tab or the device has since moved
to: another signing in from the sign-in page, a switch, or the next account after a sign-out.
Otherwise a page would send one account's queued writes with another's token in the moment
before it reloads. A page whose account has signed out has no session at all. A tab that sees
its account signed out in another tab leaves for another account or the sign-in page
(`followAccountChanges`, from `routes/_app.tsx`), waiting first for any held draft
(`holdUpdateReload`) to close. The write path checks the removal marker before starting a
transaction, including while another tab is waiting for the server to sign out. The tab also deletes the account's database if the tab that signed
it out could not, because this one had it open (`throw-account-removed:<id>`).

**An older build's sign-out is noticed.** A build from before the list changes only the
session keys. `throw-active-account` records whose session this build last put in use; when
the keys no longer hold it, that account is dropped from the list rather than left there with
a session that has ended.

**Only accounts open in a tab sync.** Their outboxes send and their shapes stream. An account
open in no tab keeps its queued changes on the device until it is switched to.

**Signing out removes one account.** For the account in use (`signOutCurrentAccount`, from
Settings > Account) it is what it was, then the device carries on as the next account, or goes
to sign-in when none is left. For another account, `signOutAccount` ends its session with its
own token and deletes its database, outbox and per-user state without opening them. Both
should warn first about changes that have not synced; for an account not in use,
`unsyncedChanges` reads the count from its outbox's store.

**An expired session keeps its data and leaves the others signed in.** The sync indicator's
"sign in again" (ADR 0002) forgets only the page's account and returns to its page once the
same account signs in.

**The sign-in page adds an account.** Reached while another is signed in, it shows "Back to
your tasks", and a sign-in there adds to the list and loads the new account's page. The
desktop rail, phone project switcher and Account settings share an account list built on
these helpers. The rail and phone avatars also switch accounts by swipe in list order.

## Compatibility

No request or shape changes, and the API protocol is unchanged. Old clients and new servers
are unaffected: each account's session is ordinary. A downgraded build finds the account in
use under its old keys; the other accounts' sessions and data stay on the device, unused,
until a newer build runs again.

## Consequences

- Preferences that were per device stay per device: theme, app icon, board settings and rail
  widths.
- The session cookie Better Auth leaves in a browser is the last account to sign in. The
  bearer token takes precedence over it on every request, which `e2e/accounts.spec.ts` checks
  by writing as the first account after the second signed in.
- A bookmark saved while one account was signed in has no number, and opens whichever account
  was last used once there are several. A numbered address means a different account, or
  nobody, on another device.
- Code that reads `window.location.pathname` sees the number. Compare `currentPath()` instead,
  and build an absolute link outside the router with `pagePath`.
- The ids of accounts that signed out stay on the device with their numbers.
