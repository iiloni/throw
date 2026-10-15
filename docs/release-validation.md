# Release and backup validation

Validated on 2026-10-15 in the assigned `feat/releases` worktree. Catch was read only.
The owner chose an operator-owned deployment directory, using Throw's combined example,
public GHCR/GitHub Releases distribution, and Catch's stable/preview/dev version rules.

## Results

- `./scripts/dev.sh check`: passed; 284 unit tests, lint, typechecks, branding integrity and
  web/server builds. Release/version/channel/changelog tests exercise temporary Git fixtures
  and mocked GitHub API calls; no Throw repository tag was created or pushed.
- `./scripts/dev.sh e2e --workers=1`: **34 passed, 5 expected layout skips**, no retries.
  Both desktop and Android-sized Chromium cover backup creation/download/upload/deletion,
  schedule persistence, admin exclusion, changed/matching/malformed build metadata and
  protocol-required update prompts. Existing auth, navigation, offline writes, task conflict
  and membership/API cases also pass. Chromium 153.0.8010.12.
- Actual helper dry runs: `preview minor --dry-run` selected `v0.1.0-preview` without
  creating a tag, and `changelog --repo iiloni/throw` generated the expected commit links.
- Targeted Firefox 155.0 backups/updates: **4 passed**, no retries.
- `./scripts/dev.sh production-smoke`: **passed** with a real linux/amd64 production
  image and Postgres 17.11, using the combined example's Throw profile. Verified startup
  migrations, web/build metadata and worker serving, non-superuser backup/restore, session
  exclusion, preserved live table identity, an unchanged sibling Catch database, scratch
  database cleanup, and automatic pre-update and scheduled backups. All disposable
  containers, volumes, network, image and temporary configuration were removed.
- Signed preview APK build with a disposable test key: **passed** (`assemblePreviewRelease`,
  JDK 21.0.12.1 / SDK 36 / Gradle 8.14.3). `apksigner verify --verbose` verifies one signer
  with APK Signature Scheme v2. Package inspection confirms `org.iloni.throwtasks.preview`,
  version `0.0.1-preview`, code `1000000001`, minimum API 24 and target API 36. The key was
  generated outside the checkout and removed after the build. No app was installed on a device.

The web prompt E2E enables the production check in Vite's served module and controls
`build.json`; service-worker install/activation, offline preparation, durable-write waits,
blocked drafts, failure retry and native update targeting are unit tested. The Android
Playwright project is browser emulation, not native Android. The native updater's device
permission/installer interaction has not been driven on a phone.

## Painted UI

The seeded administrator's settings were inspected in the collaborative browser at 1280 CSS
pixels and at a Pixel 7-sized 412 CSS pixels (desktop user agent). No horizontal overflow
was observed at the phone width. These are real development UI frames, not mockups.

[Desktop backup settings](release-validation/backups-desktop.png) ·
[Phone backup settings](release-validation/backups-phone.png)

## First-release readiness

Already in place: a public `iiloni/throw` repository, enabled Actions with the pinned actions
allowed, and the active default-branch PR Checks ruleset. Workflows declare their required
write permissions; no broad default token permission change is needed.

Not configured: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, and `RELEASES_ENABLED=true`. The Throw GHCR package does not exist
yet; after its first publication it needs an owner-approved Public visibility change for
anonymous pulls. A persistent owner signing key and secure off-repository backup are needed;
the disposable validation key is not suitable for distribution. A protective `v*` tag ruleset
is recommended separately. [Release setup](releases.md) gives exact commands and values.

No release/tag push, repository-secret creation, setting change or test-channel publication
was authorized or performed. Workflow publication/promotion remains tested with local fixtures
and mocked APIs. Actual registry publication, arm64 image execution, owner-key signing,
GitHub-hosted release jobs, and a native device upgrade remain unverified.
The combined smoke test used a sibling Catch database, not a running Catch app. Remote
TLS/proxy configuration has not been exercised.

The port drops Catch's marketing site/site refresh, attachment/media backup machinery,
note-specific editor/capture integration and optional icon picker. Throw's shell draft guard
and database model replace the corresponding note behavior. No Catch-only push, Firebase,
sharing, reminders or widget distribution setup was introduced.
