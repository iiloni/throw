# Throw — Arc Forward construction specification

## Final identity and reference normalization

The identity is a cream project tile advancing above two broad upward-curving ribbons. The tile retains one rounded color square and one gray line. Its clockwise angle and upper-right position balance the tapered lower-left sweeps. There are no arrowheads, extra ticks, additional lines, landing ellipses, letters or badges.

The supplied 1536-square reference includes a white presentation margin. For comparison only, its tile was cropped at `(75,83)`–`(1462,1459)` and normalized to a square. These approximate raster bounds are not construction constants. Production uses a clean 1024-square tile and smooth deliberately constructed vectors, not traced raster edges.

The reference contains uneven lighting and a deeper right-hand teal. Production standardizes that lighting into explicit gradients, retains `#20AE96` as primary jade and uses a lighter `#179A86` deep stop. This avoids the previously rejected dark-forest treatment. The reference's relative foreground sizing, two sweep silhouettes and near-upper-right tile placement are preserved closely, but the production colors and lighting are deliberately not pixel samples.

## Canonical geometry

All numbers are SVG units on a **1024 × 1024** canvas. SVG y increases downward. Positive rotations are clockwise. Every channel uses the same measurements, paths, order and transforms.

| Element | Exact measurement | Canvas percentage where useful |
|---|---|---|
| Background | x/y 0; width/height 1024; radius 228 | radius 22.265625% |
| Tile center | `(732,459)` | `(71.484375%,44.824219%)` |
| Tile local rectangle | `(-182,-192,364,384)` | size 35.546875% × 37.5% |
| Tile corner radius | 68 | 6.640625% |
| Tile transform | `translate(732 459) rotate(16)` | 16° clockwise |
| Internal square | local `(-114,-126,118,118)`; radius 28 | size 11.523438%; radius 2.734375% |
| Gray line | local `(-120,42,248,56)`; radius 28 | size 24.21875% × 5.46875% |
| Gap: square bottom to gray-line top | 50 in tile-local y | 4.882813% |
| Tile visible bounds, excluding shadow | approximately `(520.237135,240.380891)`–`(943.762865,677.619109)` | Rounded-rectangle geometry bounds, not rotated rectangular-box corners |
| Upper ribbon start | `(36,916)` | `(3.515625%,89.453125%)` |
| Lower ribbon start | `(60,950)` | `(5.859375%,92.773438%)` |
| External clear space | at least 96 outside the icon tile / standalone mark bounds | 9.375% of displayed tile width |

Tile-local internal geometry rotates together with the tile. The square's local center is `(-55,-67)`; the line's is `(4,70)`. The internal square is a rounded square rather than a bullet, checkbox or new symbol.

### Ribbon paths — exact authority

These are closed filled cubic Bézier silhouettes, not stroked centerlines. Their width is intentionally variable. Draw upper ribbon, lower ribbon, tile surface, internal square, then line. The broad terminal edges pass behind the opaque tile; do not shorten them at the visible contact point or add arrowheads.

Upper:

```svg
M 36 916
C 84 638 286 415 594 326
C 641 313 687 305 734 300
L 735 438
C 428 427 192 628 36 916 Z
```

Lower:

```svg
M 60 950
C 167 721 347 571 529 537
C 627 517 721 506 810 505
L 808 653
C 461 613 214 739 60 950 Z
```

Useful vertical cross sections for checking reconstruction; values rounded to 0.001:

| x | Upper top/bottom y | Upper vertical thickness | Lower top/bottom y | Lower vertical thickness | Gap between ribbons |
|---:|---|---:|---|---:|---:|
| 150 | 634.151 / 740.497 | 106.346 | 797.470 / 846.925 | 49.455 | 56.973 |
| 300 | 474.305 / 586.903 | 112.599 | 643.005 / 737.165 | 94.160 | 56.101 |
| 500 | 358.597 / 473.714 | 115.118 | 543.401 / 664.057 | 120.656 | 69.686 |

These are vertical thicknesses, not normal-to-curve stroke widths. The exact paths always win over rounded cross sections. Tails approach the tile boundary but remain finite, clean shapes; they do not require a background-shaped clip.

## Shared surfaces, gradients and depth

Full palette tables, HEX/RGB/alpha and channel-specific paint values are in `throw-channel-spec.md` and the JSON files. Shared cream and charcoal match Catch's saved production values. The only additional neutral colors are icon-surface/detail values, not application theme additions.

All gradients are linear, `gradientUnits="userSpaceOnUse"`, explicitly sRGB-interpolated. All stops have opacity 1. Positions are fractions of the specified vector, not absolute canvas x percentages.

| Paint role | Vector | Stops | Coordinate space |
|---|---|---|---|
| Channel background | `(0,0)` → `(1024,1024)` | 0%, 55%, 100% | canvas; 45° down/right |
| Upper ribbon | `(36,916)` → `(690,340)` | 0%, 48%, 100% | canvas; up/right |
| Lower ribbon | `(60,950)` → `(750,565)` | 0%, 52%, 100% | canvas; up/right |
| Internal square | `(-114,-126)` → `(4,-8)` | 0%, 55%, 100% | tile-local; rotates with tile |
| Tile surface | `(-182,-192)` → `(182,192)` | creamHighlight at 0%, cream at 100% | tile-local; rotates with tile |

The tile surface gradient is the only shared surface highlight. There is no glossy streak, stroke, radial glow or separate highlight shape. At small/micro sizes the tile becomes flat cream.

Primary depth is a **tile-attached drop shadow** on the surface rectangle: dx 0, dy 14, Gaussian standard deviation 12, opacity 0.14, normal alpha compositing and sRGB filter interpolation. Its filter rectangle in tile-local coordinates is `(-242,-252,484,504)`. The shadow rotates with the tile. Channel tint is defined separately. There is no ellipse, no ground/landing shadow and no background-outline shadow.

## Detail tiers and size behavior

| Displayed icon size | Source | Changes from primary |
|---|---|---|
| 128 px and above | `throw-icon-{channel}.svg` | Full gradients and tile-attached shadow |
| 48 px to below 128 px | `throw-icon-{channel}-small.svg` | Omit shadow; flat cream tile; retain ribbon/square gradients |
| 16 px to below 48 px | `throw-favicon-{channel}.svg` | Also flatten ribbon and square paint; line becomes local `(-120,38,248,64)` with radius 32 and `#AEB3B0` |

The micro line keeps its center `(4,70)`, width and rotation; only thickness/contrast change. Ribbons, square and tile dimensions remain unchanged at all tiers. There is no extra foreground scaling, enlarged card or removed ribbon. All treatments share the same tier adjustments. Sizes below 16 px are not specified.

Choose a tier from intended **display size**, not a high-density backing bitmap size. If display size is unknown for a platform-generated install icon, the integration agent should use the relevant platform context rather than infer it from export resolution alone.

## Monochrome and standalone behavior

`shared/throw-mark-mono-dark.svg` and `throw-mark-mono-light.svg` have transparent backgrounds, two solid ribbon silhouettes and a solid tile with transparent square/line knockouts. A 10-unit transparent clearance around the tile keeps ribbons from visually merging with it. This clearance is derived from the canonical tile via a 20-unit mask stroke; no ribbon is redrawn. SVG luminance masks exist only to produce these deliberate transparent regions, not a launcher outline.

`shared/throw-adaptive-monochrome.svg` uses white alpha artwork and the same adaptive transform. Android controls its tint. The themed icon is shared across channels, so color-only channel identification is naturally absent when the system themes it. Do not add a badge to compensate.

The colored standalone symbol is omitted. The pale ribbon and cream combination relies on the colored tile for predictable contrast. Use monochrome artwork on arbitrary surfaces.

## Android adaptive and PWA maskable geometry

The Android guide specifies 108 dp layers and a centered 66 dp safe area; separate foreground/background and a monochrome layer support masking and user theming. See [Android adaptive icon guidance](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive), checked 2026-10-13.

This package conservatively inscribes essential artwork in a centered circle of radius **312.888888889** on the 1024 canvas. Map canonical point p to `q = (512,512) + 0.55 × (p − (491,586))`, equivalent to `matrix(0.55 0 0 0.55 241.95 189.7)`. This uniform transformation balances the asymmetric sweep and keeps its lower-left tips safe. It is the same in all channels.

Foregrounds have no rounded background, shadow, baked launcher mask or extra padding. They use the small-tier paint treatment. Backgrounds are opaque, full-bleed channel gradients with no corner radius. Preserve the whole 1024 layer when converting to a 108 dp layer; do not add another inset on top of the existing transform.

For source QA, the centered 72 dp viewport spans `170.666666667`–`853.333333333`, with circle radius `341.333333333`. Circle, rounded-square and squircle masks were inspected. At a 2048 px render, maximum painted radius above alpha 1/255 was **310.082**, inside the conservative safe radius for all channels and the monochrome layer.

PWA maskable sources use a separate transform: `q = (512,512) + 0.70 × (p − (491,586))`, or `matrix(0.70 0 0 0.70 168.3 101.8)`, on an opaque full-bleed background. All foreground geometry fits the centered radius-409.6 safe circle; the measured maximum painted radius was 394.906 at 2048 px. That is the [manifest maskable safe-zone convention](https://www.w3.org/TR/appmanifest/#icon-masks). Do not use a rounded primary SVG as a maskable source.

## Decisions and deviations

| Decision | Reason |
|---|---|
| Square 1024 canvas without presentation margin | Predictable source sizing and platform export |
| Clean 16° rotation and rounded rectangles | Reproducible approximation of the approved softened raster shapes |
| Two closed cubic ribbons | Faithful broad tapered sweeps, controlled separation and maintainable geometry |
| Finite tips just inside the background boundary | Avoid clipped/blurred raster-tail ambiguity and keep platform transforms deterministic |
| Lighter deep jade and simpler lighting than the reference | Preserve the specified jade anchor and avoid rejected dark-forest teal |
| One modest attached shadow; no ellipse | Restrained depth while honoring the explicit exclusion |
| Purple/blue ribbons and square as documented paint overrides | Coherent channel treatment without changing shape or leaving unrelated jade accents |
| Micro paint simplification and slightly thicker line | Reduce shading noise and preserve internal detail at favicon sizes |
| Different adaptive/maskable uniform transforms | Preserve composition under different platform safe zones |
| Shared Manrope ExtraBold outlined wordmark | Family continuity with Catch; no runtime font or UI typography change |
| No color standalone export | Reliable background-independent use supplied by mono marks |

## Completed QA and limits

All 60 SVGs were XML-parsed and rasterized using sharp/libvips/librsvg 2.63.2. Sources contain no raster image, text/font dependency, script or external reference. IDs are unique and paint/mask references resolve. JSON files parse. Geometry signatures match across all channel pairs for every icon tier, both adaptive layers and maskable artwork; canonical/master signatures match.

Actual assigned-size PNGs were produced at 1024, 512, 192, 128, 64, 48, 32, 24 and 16 px for each treatment. The stable reference comparison, all channel size sheets, enlarged small-size comparisons, adaptive masks, monochrome mark and horizontal/stacked light/dark wordmarks were visually inspected. At 16 px the square and line remain antialiased detail clusters rather than independently crisp UI symbols. Development blue has intentionally lower tonal contrast than preview purple, while the tile and separated sweeps remain readable.

Raster proofs are artwork QA, not WCAG certification or application/device testing. No Android build, emulator, physical launcher or web project was available or modified. The later integration agent must perform platform checks. All 23 previously snapshotted Catch source files remained unchanged. The validation and integrity reports are included.
