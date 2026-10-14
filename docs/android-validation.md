# Android port validation

Validated on 2026-10-14 in the `feat/android` worktree's isolated development stack.
Catch at `/home/iiloni/Development/personal/catch` was inspected read-only.

## Scope and identity

The owner chose `org.iloni.throwtasks` / Throw, `.dev` / Throw Dev and `.preview` /
Throw Preview. The Capacitor 8 Android shell uses Catch's Gradle wrapper/toolchain, channel
flavours, bundled/live-reload development workflow, keyboard-insets plugin and system-bar
styling. App supplies native back navigation; Network and Capacitor SQLite are registered
by `cap sync`. The existing TanStack native SQLite adapter, IndexedDB outbox, native bearer
session storage and server-URL setup path were already present and are reused unchanged.
There are no server, shared schema or collection/persistence changes in this port.

Catch's sharing, media/attachments, reminders, widgets, icon picker, updater and their
permissions/components were omitted because Throw has no corresponding features. Firebase
and release signing configuration are omitted. SQLite's transitive biometric permissions
are explicitly removed because Throw uses neither encrypted databases nor biometric auth.
Only Internet/network state and AndroidX's generated signature permission remain in the
merged APKs. Backup/transfer exclusions follow the
[SQLite plugin's Android guidance](https://github.com/capacitor-community/sqlite#android-quirks)
to keep a device database from being restored independently of its session and outbox.

The artwork generator now writes to the live Android source sets rather than staging.
All 144 platform outputs regenerate/check; all 57 source-derived SVGs and their source
integrity manifest pass. Launcher/adaptive/themed icons keep the original geometry and
system splash slots use mechanically rendered channel icons without wordmarks.

## Checks

- `./scripts/dev.sh check`: passed (asset integrity, lint, typechecks, 124 unit tests and
  production builds). Three new keyboard tests cover inset hydration/focus dismissal,
  late-current-response ordering and delayed listener cleanup after unmount.
- `./scripts/dev.sh e2e --workers=1`: full local suite passed, 16 passed / 4 expected
  layout skips, against this checkout's stack.
- `E2E_FIREFOX=1 ./scripts/dev.sh e2e e2e/auth.spec.ts e2e/projects.spec.ts --project=firefox
  --workers=1`: all eight passed. Chromium 153.0.8010.12; Firefox 155.0.
- Each channel was built with `THROW_CHANNEL=<channel> pnpm --filter @throw/web android:sync`
  followed by its matching `assembleDevDebug`, `assembleStableDebug` or
  `assemblePreviewDebug`, with JDK 21, SDK 36 and Gradle 8.14.3. All final builds passed.
- APK inspection confirms each name/ID, the matching bundled channel, dev-only HTTP/mixed
  content support, and the reduced merged permission list. Stable/preview retain HTTPS
  server setup with cleartext and mixed content disabled.
- CI compiles all three matching debug builds on one runner with Gradle caching and no
  emulator, release artifacts or signing secrets. The required `validation` job fails
  closed when a code change's native build is skipped/failed/cancelled. Its unit tests and
  exact-commit CI reuse tests include the native build result.

## Physical phone

A Samsung SM-F966U1 (Android 17, Android System WebView 154.0.8037.106) was connected over
wireless adb. `./scripts/dev.sh android --static --usb --target <adb-device-id>` successfully
built, installed and started Throw Dev, bundling the page and forwarding this checkout's
API port through adb. The seeded admin session signed in on the phone; project creation
and editing were driven through the real WebView UI over its adb-forwarded DevTools port.

1. Created **Android online project** and waited for sync. A copy of the app's actual
   native SQLite file was inspected: the workspaces/projects collection tables contained
   the synced rows, including the newly created project.
2. Removed only this worktree's adb reverse mapping, making its server unreachable without
   interrupting wireless adb. Force-stopped and relaunched the bundled app: it restored
   the project from SQLite with no API access.
3. Renamed it to **Android edited offline**. The UI showed **Offline · 1 unsaved**.
4. Force-stopped and relaunched again while the server was unreachable. Both the project
   and the queued rename survived the cold start, still showing one unsaved change.
5. Restored the adb reverse mapping. The current server shape contained the renamed
   project, and the app's unsaved/offline indicator disappeared as its outbox drained.

The final debug APKs were rebuilt after adding App/back navigation and removing inherited
biometric permissions. Final Throw Dev and Throw Preview APKs also installed successfully.
Throw Dev was returned to the foreground and its server forwarding restored.

[Online WebView](screenshots/android/dev-online.png),
[offline rename WebView](screenshots/android/dev-offline-edit.png) and
[reconnected physical screen](screenshots/android/dev-synced.png) are actual phone captures.
The first two capture the WebView; the third includes the OS bars. The board itself is
still Throw's existing placeholder.

## Coverage limits and release work

The network outage was **server unreachability**, not OS airplane mode or a native Network
connectivity event: switching off Wi-Fi would disconnect the wireless adb test transport.
No emulator or other Android/WebView version was tested. The phone subsequently locked;
additional preview first-run UI, physical back/keyboard-animation, launcher masking,
themed-icon and painted system-splash checks could not be completed. Preview's native
install, channel/config, name, ID and resource packaging were verified, but a preview/stable
sign-in against a deployed HTTPS instance was not. The final rebuild's back handler is
covered by compilation, not a physical back gesture test. No update/signing test was run.

The release step still needs permanent signing keys, monotonic versionCode/version
metadata, distribution and web/Android update prompts, plus an explicit device upgrade
and backup policy. Debug APKs under stable/preview IDs must not replace a signed release
or become release artifacts. Release build tasks deliberately fail until signing and
release configuration are implemented; dev remains a separate, undistributed identity.
