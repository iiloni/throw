# Throw branding

`throw-brand/` is the complete, unmodified supplied Arc Forward source package, including
canonical geometry, channel/shared tokens, outlined lettering, font provenance/license,
derivation tools, integrity manifests and reference proofs. Its specifications define
the artwork. Do not edit public SVG copies or generated platform resources.

Stable is jade, preview is the supplied purple/indigo, and local development is light
blue. The preview tokens are deliberately retained even though Catch has subsequently
corrected its own preview colors. No application theme, font, control or project color
comes from these channel paints. All application UI override objects remain empty.

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
keep browser caches separate. PWA names, launch URL, display mode, browser theme colors,
manifest theme/background colors, build metadata and distribution rules are unchanged.
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

`BrandLockup` preserves the supplied tight canvas, proportions and external clear space.
It measures the available CSS width, chooses icon detail by displayed icon size rather
than device pixel ratio, and falls back to an icon below the specified lockup minimum.
Dark/light lettering follows the resolved application theme, including stored preferences.
Each placement has one accessible “Throw” image; there is no duplicate live lettering.

Existing surfaces use stable product artwork, following Catch's in-app convention:
sign-in has a horizontal lockup with a 48 px icon, first-run server setup a stacked lockup
with a 96 px icon, and the signed-in header a horizontal lockup with a 32 px icon. These
SVGs also work directly in Capacitor's WebView. Application typography is unchanged and
the bundled Manrope font is retained only as source provenance. The tagline is available
in the sources but is not added to these compact functional surfaces.

Catch and its active PR #112 were inspected read-only. That PR's optional app-icon picker,
native launcher aliases and selectable manifests are a separate feature; Throw keeps its
existing build-based channel selection and adds no preference setting.

## Prepared Android resources

Android project creation is deferred. `branding/android/app/src/` is a resource staging
tree, **not an Android project or a shipped APK**. No Gradle files, application ID, native
flavors, signing, distribution or Capacitor settings are introduced or changed here.

- `main/res` supplies stable legacy/adaptive artwork and the shared monochrome layer.
- `preview/res` and `dev/res` supply channel legacy icons and both adaptive color layers.
- Each source set has mdpi, hdpi, xhdpi, xxhdpi and xxxhdpi PNGs.
- Legacy icons use the small source for their 48 dp display size at every density.
- Adaptive layers map the complete supplied 1024 canvas to 108 dp (108/162/216/324/432 px).
  The supplied foreground transform is preserved with no extra inset or rounded mask.
- Shared adaptive XML is in `mipmap-anydpi-v26`; Android 13's `mipmap-anydpi-v33` also
  references the shared alpha-only monochrome PNG. Android applies masking and tinting.

When the Android project and its channel source sets are established, copy this tree's
resources into the matching `apps/web/android/app/src/` directories and change the
generator's native output root to that live tree. Wire the manifest launcher icon to
`@mipmap/ic_launcher` (including `roundIcon` if present). Use icon-only artwork in Android
system splash slots; wordmarks belong on the existing WebView setup/sign-in surfaces or
an explicitly designed app-controlled splash. Sync the matching web channel before each
native build. Preserve the established application identity and distribution policy.

Raster/alpha tests verify the favicon frames, opaque maskable surfaces, adaptive safe
zone and monochrome project-detail knockouts. Resource proofs cannot establish launcher
behavior, themed-icon rendering, system splash behavior or APK packaging. Those require
the future Android project and emulator/physical-device validation. Installed PWA icon
refresh also remains browser-controlled.
