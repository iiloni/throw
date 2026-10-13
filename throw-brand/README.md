# Throw brand source package

Production sources for **Arc Forward — Direction 4, Variant 02**. Stable jade, preview purple and development blue share one canonical icon geometry. The tagline is **Throw yourself into it.** This package does not modify Throw or Catch application code.

## Start here

1. Read `specs/throw-brand-spec.md` and `specs/throw-channel-spec.md`.
2. Inspect `validation/throw-reference-comparison.png`, `throw-channel-comparison.png` and `throw-adaptive-mask-proof.png`.
3. Give the complete folder and `specs/throw-codex-handoff.md` to the integration agent.

## Authority hierarchy

1. `shared/throw-icon-geometry.svg` — exact icon paths, rectangles, rotation and layer order. It is a renderable canonical master with stable paint for inspection.
2. `shared/throw-brand-tokens.json` — shared colors, construction metadata, gradient vectors, detail tiers, clear space and platform transforms. Canonical SVG geometry wins if metadata disagrees; resolve the disagreement before generating assets.
3. `{stable,preview,dev}/throw-*-tokens.json` — explicit channel paint values only. `extends` documents inheritance; JSON itself does not perform merging. The supplied generator resolves it.
4. Generated icon, adaptive, maskable, monochrome and wordmark-lockup SVGs — portable distribution sources derived mechanically.
5. `validation/` PNGs — QA proofs, not editable design masters or platform resources.

`wordmarks/throw-wordmark-dark.svg` separately freezes the five lettering outlines. `wordmarks/throw-wordmark-tokens.json` defines lockup layout. The light wordmark changes ink only. Font/license/provenance are in `wordmarks/source/`; no runtime font is required.

## Regeneration

From any working directory:

```bash
python3 /path/to/throw-brand/tools/derive-assets.py
python3 /path/to/throw-brand/tools/derive-assets.py --check
```

The derivation tool requires Python 3 standard-library modules only. It writes the 57 derived SVGs and `shared/throw-derived-manifest.json`. The 36 lockups cover three treatments, two orientations, two lettering inks and three icon detail tiers. These are portable exports; they are not independent geometry or typography sources.

For optional validation, install Node.js with `sharp`, and Python with Pillow/numpy. Run `tools/render-validation.cjs`, then `tools/validate-and-proofs.py`. The approved image is bundled at `validation/throw-approved-reference.png` for repeatable visual comparison. The QA tool uses `../throw-work/` as disposable staging. No validation tool operates on application projects.

`tools/outline-wordmark.py` can recreate the frozen lettering from the bundled font using fontTools. This is an optional design-source operation, not part of routine asset generation. Review any changed outlines/hash; do not substitute a newly downloaded font.

## Scope and omissions

- Channel colors apply only to release-identification artwork. All `applicationUiOverrides` objects are empty.
- Dev is an active development/testing treatment, not an official public release channel.
- Catch geometry, source files, UI tokens and build wiring remain unchanged.
- Colored standalone artwork is intentionally omitted: pale ribbons and cream are unreliable on arbitrary light surfaces. Use the supplied transparent monochrome marks instead.
- No raster artwork is embedded in SVGs. No application manifests, Android resource XML, final density assets or favicon ICO files are supplied; those belong to integration.
- No wordmark or tagline belongs in launcher icons, favicons or adaptive-icon layers.

`package-manifest.json` lists all other packaged files and their hashes. Retain the whole source package when integrating; avoid maintaining separately edited channel SVGs.
