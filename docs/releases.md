# Releases

Throw publishes `ghcr.io/iiloni/throw` for linux/amd64 and linux/arm64 and signed Android
APKs with SHA-256 files on [GitHub Releases](https://github.com/iiloni/throw/releases).
The production image includes the web build, migrations and backup CLI. It never deploys
to an operator's server. Production setup is in [Deployment](deployment.md).

## Channels and versions

| Channel | Git tag | Image tags | Android package |
| --- | --- | --- | --- |
| Stable | `v0.1.0` | `0.1.0`, `stable`, `latest` | `org.iloni.throwtasks` |
| Preview | `v0.1.0-preview` | `0.1.0-preview`, `preview` | `org.iloni.throwtasks.preview` |
| Dev | none | none | `org.iloni.throwtasks.dev` |

These are Catch's rules: explicit SemVer core versions, a single unnumbered `-preview`
suffix, no leading zeroes or build metadata. Preview advances independently of stable.
Backports never move a channel alias backwards. A preview is promoted by tagging its exact
commit without the suffix, then rebuilding the stable image and APK. Never move or reuse
a published tag. Build-only `THROW_CHANNEL` defaults to dev; released artwork follows Throw's
[branding](branding.md), with no port of Catch's optional icon picker.

Android's version name is the tag without `v`. Its version code is **1,000,000,000 plus this
repository's Release workflow run number**, restricted to run numbers 1–99,999,999. This
Throw allocation differs from Catch's unoffset sequence; application IDs and queues are also
separate. Preserve `release.yml` and its workflow identity; a reset needs a higher baseline.
Reruns preserve the original code. Finish/retry a release before starting the next one.
As in Catch, a later backport run can give an older version a higher code than an already
published newer APK. A device that installs that backport needs a subsequent forward
release to upgrade; never overwrite published APKs to work around the code sequence.

## One-time setup

Throw is public (verified 2026-10-15). No signing secrets or release variables were configured
when this feature was implemented. The existing CI protection and Actions configuration are
described in [CI](ci.md); adding these workflows does not change repository settings.

1. Create and securely back up a persistent signing key outside every checkout, using JDK 21:

   ```bash
   umask 077
   mkdir -p ~/.local/share/throw-signing
   keytool -genkeypair -storetype PKCS12 \
     -keystore ~/.local/share/throw-signing/release.keystore \
     -alias throw -keyalg RSA -keysize 3072 -validity 10000
   ```

   Answer keytool's password and certificate prompts. With PKCS12, use the store password
   as the key password. Losing this key prevents updating existing installs.
2. Configure four **repository Actions secrets**:

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | Base64 of the keystore file |
   | `ANDROID_KEYSTORE_PASSWORD` | Store password |
   | `ANDROID_KEY_ALIAS` | `throw` for the example above |
   | `ANDROID_KEY_PASSWORD` | Key password (same as store password for PKCS12) |

   The owner can enter them privately through GitHub Settings, or from their terminal:

   ```bash
   base64 -w 0 ~/.local/share/throw-signing/release.keystore | gh secret set ANDROID_KEYSTORE_BASE64 -R iiloni/throw
   gh secret set ANDROID_KEYSTORE_PASSWORD -R iiloni/throw
   gh secret set ANDROID_KEY_ALIAS -R iiloni/throw
   gh secret set ANDROID_KEY_PASSWORD -R iiloni/throw
   ```

   The last commands prompt without printing the values. Never send credentials in chat.
   An agent collecting a secret must use the private secret-entry tool, and must have
   explicit owner approval before creating repository secrets. The workflows decode the
   key into a temporary owner-only file, disable Gradle configuration caching, and remove
   the file even after failure.
3. When ready to enable publishing, explicitly approve/set the repository Actions variable
   `RELEASES_ENABLED=true`. Absence or any other value disables builds/publication and
   prevents manual tagging/promotion. No PAT is required: scoped `GITHUB_TOKEN` permissions
   publish images, tags and releases and dispatch CI.
4. After the first publication, explicitly change the **Throw GHCR package** to Public.
   Repository visibility alone does not do this; public packages allow anonymous pulls.
   See [GitHub's container registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
   Until then, operators need registry credentials. Private GitHub Releases would also
   break the anonymous Android updater; private distribution is not supported here.
5. Recommended: protect `v*` tags against modification/deletion, while allowing the release
   workflows to create them. This is a separate owner-approved repository setting.

No release, tag push, repository-secret creation, or setting change is implicit in opening
or merging this PR. An agent needs the owner's specific authorization for each such action.

## Workflow and recovery

`tag-release.yml` accepts `channel` and `version_type` (patch/minor/major). A read-only job
executes the default branch's trusted helper at an immutable commit against a separate
checkout of the selected target. A separate privileged job creates the annotated remote
tag through GitHub's API without executing checked-out code. It explicitly dispatches
Release because tags created with `GITHUB_TOKEN` do not trigger another workflow.
`promote-release.yml` resolves an explicit preview tag (including annotated tags), creates
the corresponding stable tag at that commit, and dispatches Release. Both share the
`throw-tag-release` queue; neither overwrites a tag.

`release.yml` accepts a pushed `v*` tag or dispatch on an existing release tag. It rejects
branch refs before checkout, validates version/signing inputs, and waits for successful
**check, android build, e2e (desktop), e2e (android)** jobs for that exact commit. It requests
manual CI on the tag if no full pass exists, with a 30-minute wait. Failed CI requires an
explicit rerun. PR merge-commit CI is not substituted for tagged-commit CI.

The signed APK and multi-platform image build in parallel. Only after both succeed does
publication upload APK/checksum to a draft, advance eligible channel aliases, then publish
the GitHub Release. Preview is a prerelease and never GitHub's latest stable release.
The exact image may remain after an APK failure; aliases do not advance at that point.
An interrupted unpublished release can resume from its draft. Published releases cannot
be overwritten: choose a new version. Retry the existing Release run to preserve its
version code; rerunning Tag release creates another version. Promotion recovery dispatches
Release on the stable tag that was already created.

Examples, **only after authorization and setup**:

```bash
gh workflow run tag-release.yml -R iiloni/throw --ref main -f channel=preview -f version_type=minor
gh workflow run promote-release.yml -R iiloni/throw --ref main -f preview_tag=v0.1.0-preview
# Recovery after a tag exists:
gh workflow run release.yml -R iiloni/throw --ref v0.1.0-preview
```

Local helpers use Node 24 and installed dependencies, never fetch or push, and use the
highest reachable stable/preview core version as the bump baseline (0.0.0 with no tags):

```bash
git fetch origin --tags
./scripts/release.sh preview minor --dry-run
./scripts/release.sh stable promote v0.1.0-preview --dry-run
./scripts/release.sh changelog                 # unreleased changes
./scripts/release.sh changelog v0.1.0-preview  # one release
```

Removing `--dry-run` creates a local annotated tag. Pushing it is a separate publication
trigger. Changelogs derive from Conventional Commits and tags, include breaking changes
and protocol upgrade order, and link to GitHub comparisons. There is no marketing site,
site refresh workflow, or committed changelog. Release notes record image digest, source
commit and Android version code. Actions APK artifacts expire after seven days; published
Release assets persist.

Local signed builds require `THROW_VERSION`, `THROW_VERSION_CODE`, `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Sync the
matching `THROW_CHANNEL` before `assembleStableRelease`/`assemblePreviewRelease`. Missing
signing inputs fail; dev has no release build. Debug stable/preview APKs cannot replace
releases signed with another key. Sync pending work before uninstalling such a debug build.

## Client updates and compatibility

Settings shows server channel/version, installed Android version, channel-filtered recent
releases, and manual checks. Launch, focus, resume, reconnect and five-minute checks refresh
the update state. Android targets the server's **exact**, newer published version within
the installed channel. The plugin verifies SHA-256, package identity, version name,
increasing version code and signing certificate before opening Android's installer.
Installation and unknown-source permission still need the device owner's confirmation.
Dev apps are excluded; changing channel installs the separate package without replacing data.
In-place updates keep SQLite, the outbox, account/session storage and server settings. Android
OS backup/transfer remains disabled: a server backup covers synced server state, not unsent
device writes. Sync those writes before uninstalling or replacing a device. Downgrades and
differently signed APKs cannot replace the installed app through the updater.

Web/PWA builds publish uncached `build.json` with a UUID embedded in the client. A changed
build offers **Reload to update** or **Later**, with reload retained in Settings after
dismissal. Old/malformed metadata and network failures do not invent an update. Reload
waits for pending writes to reach the outbox/server, installs/activates a waiting worker,
then reloads only that tab. Other tabs choose when to reload. The logic also works without
service workers; Vite and native builds do not poll web metadata. Shell drafts block reload;
new editors must acquire the guard in `lib/useUpdateReloadBlocked.ts` until they flush.

Release versions are separate from [ADR 0003](decisions/0003-api-compatibility.md)'s API
protocol. A 426 pauses sync, preserving local tasks and the outbox. Client-too-old prompts
**Update required to sync** even if an optional prompt was dismissed or web metadata is
unavailable, with **Keep working offline**. Server-too-old asks for a server upgrade.
Authenticated version discovery is exempt from the protocol gate to allow this recovery.
No protocol or collection schema version changes are needed for these additive endpoints.
