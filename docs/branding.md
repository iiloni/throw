# Throw branding

`throw-brand/` is the complete, unmodified supplied Arc Forward source package, including
canonical geometry, channel/shared tokens, outlined lettering, font provenance/license,
derivation tools, integrity manifests and reference proofs. Its specifications define
the artwork. Do not edit public SVG copies or generated platform resources.

Stable is jade, preview is the supplied purple/indigo, and local development is light
blue. The preview tokens are deliberately retained even though Catch has subsequently
corrected its own preview colors. Application UI overrides in the supplied package remain
empty. Throw's separately approved UI palette is authored in `apps/web/src/styles.css`,
without importing icon/channel paints into application theming.

## Application palette

All builds use the same jade UI accents, independent of their installation artwork:

| Role | Light | Dark |
| --- | --- | --- |
| Primary action fill | `#20AE96` | `#20AE96` |
| Primary action lettering | `#292B2D` | `#292B2D` |
| Links and keyboard focus | `#0B7765` | `#70DDC6` |
| Selected/hover surface | `#E3F2EC` | `#173D34` |

Primary action hover adds 8% white to jade rather than reducing fill opacity, preserving
the charcoal lettering's contrast on dark surfaces. The selected surface marks the current
rail destination, the dock's indicator, the highlighted menu row and a pressed choice such
as the theme; hovering a rail or icon-grid item shows it at 60%. Project marks and the
color picker keep their own project colors. The manifest theme color is jade;
browser light/dark bar backgrounds stay warm. Neutral surfaces, glass, typography,
project/tag colors and error colors retain the existing family design.

## Generation

From the repository root, with Python 3 and the locked pnpm dependencies installed:

```bash
python3 throw-brand/tools/derive-assets.py --check
node scripts/generate-brand-assets.mjs
node scripts/generate-brand-assets.mjs --check
```

The platform generator checks every packaged file against `package-manifest.json` before
rendering or copying. It uses sharp/libvips/librsvg (locked in `pnpm-lock.yaml`), preserving
sRGB gradients, the attached shadow, alpha and mask knockouts. `pnpm brand:generate` and
`pnpm brand:check` wrap those Node commands. `./scripts/dev.sh check` runs the platform
integrity/regeneration check along with the usual lint, typechecks, tests and builds.
The source package is excluded from automatic formatting to preserve its hashes.

For a future approved artwork revision, change the canonical geometry/shared or channel
tokens (and explicit lettering authority when necessary), run the supplied derivation
tool, review all treatments together, update the source-package integrity manifest, then
regenerate platform files. The platform generator deliberately refuses a partially
updated package. Reference PNGs never supply production artwork.

## Web and PWA

Vite's existing `THROW_CHANNEL` selects stable root paths, `/preview/` or `/dev/` for the
default favicons, Apple touch icon and install manifest; unset means dev and unsupported
values fail through the existing channel parser. Channel paths keep browser caches
separate. Every build also emits `manifest-stable.webmanifest`, `manifest-preview.webmanifest`
and `manifest-dev.webmanifest` for the [app icon switcher](#app-icon-switcher); they differ
only in icon paths and share the app id `/`, launch URL, display mode, browser bar colors
and background color. The manifest theme color uses the approved jade primary action fill.
All generated public artwork and the manifests are precached by the existing service worker.

| Surface | Mechanical source |
| --- | --- |
| 192/512 ordinary PWA exports | Primary channel icon |
| 16/24/32 PNG and SVG favicons; 16/32 ICO frames | Micro channel favicon |
| 48 PNG favicon and ICO frame | Small channel icon |
| 512 maskable PWA icon | Channel maskable SVG, full bleed with its own safe-zone transform |
| 180 Apple touch icon | Channel maskable SVG; the platform supplies the mask |
| Transparent product symbols | Shared dark/light monochrome SVGs |
| Outlined wordmark alone | Shared dark/light wordmark SVGs |
| Repository-root `favicon.ico` | Copy of the stable web `favicon.ico`, for tools that show a project icon |

`BrandLockup` preserves the supplied tight canvas, proportions and external clear space.
It measures the available CSS width, chooses icon detail by displayed icon size rather
than device pixel ratio, and falls back to an icon below the specified lockup minimum.
Dark/light lettering follows the resolved application theme, including stored preferences.
Each placement has one accessible “Throw” image; there is no duplicate live lettering.

Existing surfaces use stable product artwork, following Catch's in-app convention:
sign-in has a horizontal lockup with a 48 px icon, first-run server setup a stacked lockup
with a 96 px icon, and the navigation rail a horizontal lockup with a 32 px icon at its
top. The collapsed rail is narrower than the lockup's minimum, so it shows the mark alone,
on the rail's icon column. The phone layout has no rail and no artwork: its header's one
quiet line names the workspace. These
SVGs also work directly in Capacitor's WebView. Application typography is unchanged and
the bundled Manrope font is retained only as source provenance. The tagline is available
in the sources but is not added to these compact functional surfaces.

## App icon switcher

Settings > General has Catch's App icon section (`components/AppIconPicker`,
`lib/appIcon.ts`) on dev and preview builds: the chosen icon's preview above a text-only
segmented control. Each build starts with its own channel's icon, unlike Catch, whose
released builds default to stable. A build offers its own icon and those of the channels
released before it: stable none (no section), preview Stable and Preview, dev all three.
The choice is device-local (`throw-app-icon`); a stored choice the build does not offer is
ignored. The channel is the installed Android app's once its version is known, otherwise
the web build's `THROW_CHANNEL`.

On the web the choice repoints the favicons, Apple touch icon and manifest link; an inline
script in `index.html` restores it before the app starts, offline too. The preview is the
manifest's 512 px PWA PNG. Installed web apps may ask to approve the new icon, and browser
support varies. On Android, `AppIconsPlugin` enables one of the `StableIcon`, `PreviewIcon`
and `DevIcon` launcher aliases of MainActivity, which stays enabled for other intents and
existing shortcuts. The flavor's `default_*_icon` booleans enable its own alias in the
manifest, and the plugin refuses icons the build does not offer. Its preview renders the
alias's packaged adaptive drawable at 256 px with the platform mask. Splash screens, Settings
> Update's channel artwork and in-app branding always identify the actual build.

## Android resources

`apps/web/android/app/src/` is the live native output tree. Every flavor ships every
channel's launcher artwork, so the [app icon switcher](#app-icon-switcher) can choose any
of them: the platform generator writes stable launcher resources to `main/res` under their
plain names (`ic_launcher`, `ic_launcher_background`, `ic_launcher_foreground`) and
preview/dev ones beside them with `_preview` and `_dev` suffixes. Flavor source sets carry
no launcher overlays; the generator removes stale ones and its check refuses them. System
splash PNGs stay in each channel's source set. Native identity is `org.iloni.throwtasks`
(Throw), `.preview` (Throw Preview), `.dev` (Throw Dev).

- Each source set has mdpi, hdpi, xhdpi, xxhdpi and xxxhdpi PNGs.
- Legacy icons use the small source for their 48 dp display size at every density.
- Adaptive layers map the complete supplied 1024 canvas to 108 dp (108/162/216/324/432 px).
  The supplied foreground transform is preserved with no extra inset or rounded mask.
- Each channel's adaptive XML (`ic_launcher`, `ic_launcher_preview`, `ic_launcher_dev` in
  `mipmap-anydpi-v26`) pairs that channel's background with its own foreground: unlike
  Catch's shared note, Throw's ribbons and project accent take the channel's color.
  Android 13's `mipmap-anydpi-v33` also references the shared alpha-only monochrome PNG.
  Android applies masking and tinting.
- Each launcher alias uses its channel's icon for both icon and round icon; the
  application icon (app info, recents) is the installed flavor's, set by the preview and
  dev manifests.
- System splash PNGs use the primary channel icon alone, rendered at the 288 dp slot's
  density sizes without a wordmark, on warm light/dark theme backgrounds. The launch theme
  wires `windowSplashScreenAnimatedIcon` to `@drawable/splash`.

Sync the matching web channel before each native build (`THROW_CHANNEL=preview pnpm
--filter @throw/web android:sync`, then `assemblePreviewDebug`). Do not edit generated
resources. Release signing/distribution is documented in [Releases](releases.md).
Raster/alpha tests verify favicon frames, opaque maskable surfaces, adaptive safe zones
and monochrome knockouts; APK and physical-device validation are documented separately
in [Android validation](android-validation.md).
