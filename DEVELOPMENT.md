# Developing Throw

This guide is for people changing Throw's code. It covers the development environment,
tests and how changes reach `main`.

For how the code is organized and the conventions it follows, read [AGENTS.md](AGENTS.md).
[docs/spec.md](docs/spec.md) describes what is being built, and [docs/decisions](docs/decisions)
records why the stack looks the way it does.

## What you need

- Docker, which runs the app, Postgres and Electric.
- Node 24 and pnpm (`corepack enable`) on the host, for end-to-end tests and editor support.

## Start the app

```bash
./scripts/dev.sh up
```

This builds and starts a stack for this checkout and prints its URL. Hot reload is on.
Sign in with `admin@example.com` / `adminadmin` or `user@example.com` / `userpassword`.

Each Git worktree gets its own stack with its own database and port, so several branches can
run side by side. See [WORKTREES.md](WORKTREES.md).

`./scripts/dev.sh help` lists every command, including `logs`, `psql`, `shell`, `seed` and
`reset`.

## Check your changes

```bash
./scripts/dev.sh check   # lint, typecheck, unit tests, build
pnpm format              # apply formatting and import sorting
```

`check` must pass before a change is finished.

### End-to-end tests

Playwright runs on the host against this checkout's stack. Set it up once:

```bash
pnpm install
pnpm exec playwright install chromium
```

Then run the specs your change affects:

```bash
./scripts/dev.sh e2e e2e/auth.spec.ts --workers=1
./scripts/dev.sh e2e e2e/auth.spec.ts --grep "signing in" --workers=1
```

The full suite is slow and runs in CI before a merge, so it is not a routine local check.
Runs take a lock shared by all worktrees on the machine and need `flock`.

## Pull requests

Changes go through a draft pull request against `main`. Commits and PR titles use
[Conventional Commits](https://www.conventionalcommits.org/).

[Pull requests and CI](docs/ci.md) explains the labels that request the full test suite and
approve a merge, and the checks a PR must pass. [AI code review](docs/ai-reviews.md) covers
the optional review.

## Android

The Capacitor project is in `apps/web/android`. Install Android Studio (Otter or newer),
JDK 21, SDK platform 36, build-tools 36.0.0 and platform-tools; set `ANDROID_HOME` to your
SDK and put `adb` on your PATH. Enable USB debugging on the phone, authorize this computer,
and connect over USB or wireless adb (`adb connect <ip>:<port>`).

```bash
./scripts/dev.sh android                 # Throw Dev with live reload over the worktree URL
./scripts/dev.sh android --usb           # adb forwards this worktree's port, including on wireless adb
./scripts/dev.sh android --static --usb  # bundled code: can reopen/edit offline
./scripts/dev.sh android --static --target <device-id>
```

The command starts this checkout's stack, builds/syncs the matching dev web assets, and
installs the separate **Throw Dev** app. Other arguments pass to `cap run android`, e.g.
`--target` when several devices are connected. The dev channel is forced; these commands
never replace the stable or preview app. Live reload needs the running server to load code;
only `--static` verifies offline cold starts. `--usb` works over either USB or wireless adb.
Without it, the phone must reach the printed worktree URL (normally over Tailscale).
Bundled dev builds pin API calls to that URL; ordinary stable/preview builds ask for the
owner's HTTPS server URL on first run. Server URL and session/preferences stay in WebView
storage, synced rows in a per-user native SQLite database, and queued writes in IndexedDB,
through the same collection/outbox path used on the web with OPFS.

| Channel | Display name | Application ID | Artwork |
| --- | --- | --- | --- |
| stable | Throw | `org.iloni.throwtasks` | Jade |
| preview | Throw Preview | `org.iloni.throwtasks.preview` | Purple/indigo |
| dev | Throw Dev | `org.iloni.throwtasks.dev` | Light blue |

To compile without a phone, sync the channel and then build its matching debug variant:

```bash
THROW_CHANNEL=preview pnpm --filter @throw/web android:sync
(cd apps/web/android && ./gradlew assemblePreviewDebug)
# stable -> assembleStableDebug; dev -> assembleDevDebug
pnpm --filter @throw/web android:open
```

Always sync each channel before building it: the native source sets choose launcher/splash
artwork, while the web build chooses its own channel assets/config. All three debug variants
compile in CI, without an emulator. CI's Playwright `android` project is Chromium with a
phone viewport, **not** a native Android test. Native icons and splash are generated from
Throw's canonical artwork with `pnpm brand:generate`; see [branding](docs/branding.md).
The App plugin supplies native back navigation; Network and Capacitor SQLite provide
connectivity and collection storage. System-bar styling follows the selected application
theme and Catch's local keyboard-insets plugin keeps the WebView full size.
Android 7 (API 24) is the minimum OS; the WebView must support the app's modern browser APIs.

Release tasks deliberately fail until signing and distribution are implemented. Before
releasing, establish version/versionCode metadata, signing keys, a release pipeline, upgrade
and backup policy, and update prompts alongside the web release. A debug build under a
stable/preview ID must be uninstalled before installing a differently signed release; keep
unsynced data safe. The permanent IDs must remain unchanged after distribution.

## Releasing

There is no release process yet. Catch's tagging, changelog and image publishing scripts
have not been ported.
