# Codex handoff — integrate Throw branding

Integrate the attached `throw-brand/` sources into Throw's existing web and Android projects. Stable is jade, preview is purple/indigo and dev is light blue for local development/testing. Keep existing build identities and distribution rules. Do not modify Catch.

First read `README.md`, `specs/throw-brand-spec.md`, `specs/throw-channel-spec.md` and `wordmarks/throw-wordmark-spec.md`. `shared/throw-icon-geometry.svg` is the exact icon geometry authority. Shared tokens define platform transforms and tier behavior; each channel token file defines its paints. The outlined wordmark and its tokens independently define typography and lockup geometry. Do not recreate artwork from the reference PNGs or by eye.

Run `python3 throw-brand/tools/derive-assets.py --check` before integration. Keep the sources, derivation tool and integrity manifest in the repository. Generated SVGs are portable copies, not separately editable masters. Future changes must start in canonical geometry/shared or channel tokens, then regenerate all treatments together.

## Mechanical source-to-output mapping

| Output/context | Source |
|---|---|
| Large ordinary web/PWA icons, e.g. 192/512 exports | `{channel}/throw-icon-{channel}.svg`, subject to documented display-size rules |
| Known 48–127 px displayed icon | `{channel}/throw-icon-{channel}-small.svg` |
| 16/24/32 px favicon; 16/32 ICO frames | `{channel}/throw-favicon-{channel}.svg` |
| 48 px favicon/ICO frame | `{channel}/throw-icon-{channel}-small.svg` |
| Android legacy launcher density assets | Appropriate icon tier for the launcher's base display size; mechanically rasterize required densities |
| Android adaptive foreground | `{channel}/throw-adaptive-foreground-{channel}.svg` |
| Android adaptive background | `{channel}/throw-adaptive-background-{channel}.svg` |
| Android themed/monochrome foreground | Shared `shared/throw-adaptive-monochrome.svg`; preserve alpha knockouts and let Android tint |
| PWA `purpose: maskable` assets | `{channel}/throw-maskable-{channel}.svg` |
| Transparent monochrome product symbol | Shared `shared/throw-mark-mono-{dark|light}.svg` |
| Web/native branded horizontal or stacked lockup | `wordmarks/{channel}/throw-lockup-{horizontal|stacked}-{channel}-{dark|light}[-small|-micro].svg` |
| Text-only brand placement | Shared outlined `wordmarks/throw-wordmark-{dark|light}.svg` |

Do not choose detail from a retina backing size alone: a 40 px displayed icon exported at 3× still needs the micro source. When platform display size is unknown, inspect the actual consuming surface and build configuration. Do not independently enlarge or reposition the project tile/ribbons.

## Integration requirements

1. Inspect the existing web manifest, icon pipeline, Android resources and build configurations. Generate only required raster sizes/formats and configure stable/preview/dev assets using existing channel selection.
2. Preserve sRGB gradients, transparency and rounded primary geometry. For platform surfaces that apply their own mask, use the supplied full-bleed/adaptive sources. Do not bake a second rounded-square mask or inset into adaptive layers. Convert the full 1024 layer to 108 dp without another foreground scale; Android applies the mask. Keep monochrome resources shared across channels.
3. Use SVG where supported, or rasterize with a renderer supporting its gradients, drop shadow and masks. Android VectorDrawable does not directly consume arbitrary SVG filters/masks: use mechanically rendered alpha artwork where necessary, or an exact supported conversion. Never discard a shadow/knockout or replace it with a solid rectangle to force conversion.
4. Keep launcher icons, adaptive layers, PWA icons, favicons and Android system splash-icon slots icon-only. Place horizontal/stacked wordmarks on appropriate existing header, onboarding, about or app-controlled splash surfaces. Respect documented proportions, clear space and minimum sizes. Select dark/light lettering by surface contrast, with identical lettering in every treatment. Avoid duplicate accessible announcements.
5. Use **Throw yourself into it.** only as supporting copy where existing UI/brand context warrants it. Do not place it inside launcher/browser icons or automatically add it to every screen.
6. Keep icon/channel paints out of application theme colors, controls, note/project colors, UI backgrounds and typography. All application UI override objects are empty. The bundled font/license is source provenance; no application font installation or typography replacement is requested.
7. Generate platform files mechanically from these SVGs, update relevant manifests/configuration, and run available web/Android checks. Inspect ordinary, adaptive, themed, maskable and favicon behavior for all three builds, including light/dark surfaces and real launcher previews where available.

Report changed files, exact generation commands, build/check results, representative screenshots and unavailable validations. Preserve this source-of-truth package and Catch files. Do not reinterpret colors, ribbon curvature/taper, tile dimensions/rotation, internal details, shadow properties, safe-zone transforms or wordmark spacing.

The package's preview background deliberately matches the saved Catch preview token file available during source creation. Current external Catch repository corrections were not supplied. Use these finalized Throw values rather than silently substituting a different purple; any future color-convention alignment must be an explicit channel-token change followed by regeneration.
