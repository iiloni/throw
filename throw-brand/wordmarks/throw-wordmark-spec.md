# Throw — wordmark and lockups

## Lettering authority

`throw-wordmark-dark.svg` is the canonical five-path lettering master. `throw-wordmark-light.svg` changes only ink. `throw-wordmark-tokens.json` contains full-precision dimensions and layout. Every build displays the same title-case **Throw** with no channel suffix in the lettering.

Use **Manrope ExtraBold 800**, matching Catch's existing wordmark system. The bundled original variable font is version 4.505, licensed under SIL Open Font License 1.1. Copyright and the unmodified license are included at `source/OFL-Manrope.txt`; the original source font and exact SHA-256 are retained. See [upstream Manrope license](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt).

Editable typography specification: 2000 units per em, native GPOS kerning enabled, additional tracking −18 font units between letters (−0.009 em). Native pair kerning for T→h, h→r, r→o, o→w is 0, 0, −20, −40 units respectively. Glyph contours are unchanged. Exact positions, advances, font bounds and normalization are recorded in `source/throw-wordmark-provenance.json`.

The outlined visible-ink viewBox is **4183.77142857 × 1024**. Frozen paths are the distribution authority; future font updates must not silently recreate this artwork. No font is installed or loaded by the logo SVG. Including this source font does not request a change to application typography.

Dark ink is `#292B2D`, RGB 41/43/45, alpha 1. Light ink is `#FFF9F0`, RGB 255/249/240, alpha 1. These are shared Catch/Throw neutral brand values. All lockup backgrounds are transparent; their icon tile remains full color. Purple/blue text is not prescribed.

## Horizontal construction

All values use an icon tile **I = 1024**:

| Measurement | Value |
|---|---|
| Tight canvas | `3731.428571427734 × 1024` |
| Icon box | `(0,0,1024,1024)` |
| Gap from tile edge to lettering ink | 256 = 0.25 I |
| Lettering ink box | `(1280,204,2451.428571427734,600)` |
| Lettering scale | 0.5859375 |
| Optical centering | 8 units above geometric vertical ink centering |

The icon is left of the text. Preserve actual visible-ink bounds rather than a font advance box.

## Stacked construction

| Measurement | Value |
|---|---|
| Tight canvas | `1536 × 1591.944055944184` |
| Icon box | `(256,0,1024,1024)` |
| Gap from tile bottom to lettering ink | 192 = 0.1875 I |
| Lettering ink box | `(0,1216,1536,375.944055944184)` |
| Lettering scale | `0.367132867132992` |
| Shared horizontal center | x = 768 |

The icon is centered above the text. There is no wordmark rotation. Canvas numbers printed here are rounded; tokens retain machine precision.

## Usage, clear space and detail selection

Reserve **192 units = 18.75% of displayed icon width** outside the tight artwork bounds. The SVG does not already include that external clear space. Do not crop, stretch or independently rescale the icon and lettering.

- Horizontal minimum tight width: 112 CSS px. A displayed 40–48 px icon yields a horizontal lockup approximately 146–175 px wide.
- Stacked minimum tight width: 96 CSS px.
- Wordmark-only minimum visible ink height: 18 CSS px.
- Below the lockup minima, use the existing icon-only source.

File pattern: `{channel}/throw-lockup-{horizontal|stacked}-{channel}-{dark|light}[-small|-micro].svg`. No suffix uses the primary icon tier; suffixes select icon detail only. Lettering paths, ratios and gaps remain identical. Pick the icon tier by displayed icon width: primary ≥128 px, small 48–<128 px, micro 16–<48 px. For a high-density export, select the display tier first and rasterize the whole composition at the required resolution.

Use horizontal artwork on existing wide brand surfaces, and stacked artwork on existing spacious onboarding/about or app-controlled splash surfaces. Launcher/adaptive/PWA icons, favicons and Android system splash-icon slots stay icon-only. Shared wordmark-only sources can be used where the icon is already present elsewhere.

## Tagline

Exact copy: **Throw yourself into it.** Preserve the period and sentence case. This is supporting brand copy, not part of the frozen wordmark or an icon detail. No tagline lockup source is prescribed. For dedicated brand collateral, Manrope Medium 500 with native spacing is the compatible supporting style; inside the application retain the existing UI text style and colors. Do not add a new font dependency or scatter the tagline through existing flows.

## Validation and handoff

Dark/light wordmarks, both orientations and all channel treatments were rendered as self-contained vector artwork. The proof sheet uses small-tier icons at its displayed dimensions. SVG outputs contain outlines, not `<text>` or font references. The source font/license is provenance only.

The source package contains generated primary/small/micro lockups for every channel and ink so a consuming project can pick an appropriate artifact without recreating layout. Rebuild them with `tools/derive-assets.py`; do not edit the repeated exported glyph paths. Update the frozen lettering only as an explicit brand revision, then synchronize the hash/layout tokens before deriving all assets.
