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

Vite's existing `THROW_CHANNEL` selects stable root paths, `/preview/` or `/dev/`; unset
means dev and unsupported values fail through the existing channel parser. Channel paths
keep browser caches separate. PWA names, launch URL, display mode, browser bar colors,
manifest background color, build metadata and distribution rules are unchanged. The
manifest theme color uses the approved jade primary action fill.
All generated public artwork is precached by the existing service worker.

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

Catch and its active PR #112 were inspected read-only. That PR's optional app-icon picker,
native launcher aliases and selectable manifests are a separate feature; Throw keeps its
existing build-based channel selection and adds no preference setting.

## Android resources

`apps/web/android/app/src/` is the live native output tree. The platform generator writes
stable artwork to `main/res` and preview/dev artwork to their channel source sets. Native
identity is `org.iloni.throwtasks` (Throw), `.preview` (Throw Preview), `.dev` (Throw Dev).

- Each source set has mdpi, hdpi, xhdpi, xxhdpi and xxxhdpi PNGs.
- Legacy icons use the small source for their 48 dp display size at every density.
- Adaptive layers map the complete supplied 1024 canvas to 108 dp (108/162/216/324/432 px).
  The supplied foreground transform is preserved with no extra inset or rounded mask.
- Shared adaptive XML is in `mipmap-anydpi-v26`; Android 13's `mipmap-anydpi-v33` also
  references the shared alpha-only monochrome PNG. Android applies masking and tinting.
- The launcher and round launcher both use `@mipmap/ic_launcher`, resolved by source set.
- System splash PNGs use the primary channel icon alone, rendered at the 288 dp slot's
  density sizes without a wordmark, on warm light/dark theme backgrounds. The launch theme
  wires `windowSplashScreenAnimatedIcon` to `@drawable/splash`.

Sync the matching web channel before each native build (`THROW_CHANNEL=preview pnpm
--filter @throw/web android:sync`, then `assemblePreviewDebug`). Do not edit generated
resources. Release signing/distribution and selectable launcher icons remain deferred.
Raster/alpha tests verify favicon frames, opaque maskable surfaces, adaptive safe zones
and monochrome knockouts; APK and physical-device validation are documented separately
in [Android validation](android-validation.md).
