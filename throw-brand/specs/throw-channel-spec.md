# Throw — channel paint specification

## Architecture

Shared Arc Forward geometry + shared neutral surface/detail colors + one channel paint file = a complete icon. Stable is Throw's product identity; preview and dev identify builds. Dev is not an official public release channel. No channel token changes the application UI.

All channel geometry, gradient vectors and stop positions are identical. The channel override files contain only background, upper/lower ribbon, project-square, micro paint and attached-shadow colors. They extend the shared token file through the supplied generator, not automatic JSON inheritance.

## Shared colors

| Semantic name | HEX | RGB | Alpha | Usage |
|---|---|---|---:|---|
| cream | `#FFF9F0` | 255, 249, 240 | 1 | shared warm tile surface and light wordmark |
| creamHighlight | `#FFFCF7` | 255, 252, 247 | 1 | tile gradient start; subtle surface lighting |
| charcoal | `#292B2D` | 41, 43, 45 | 1 | dark wordmark and monochrome mark |
| tileLine | `#C3C4C2` | 195, 196, 194 | 1 | one rounded project-detail line |
| microLine | `#AEB3B0` | 174, 179, 176 | 1 | micro-only detail line contrast adjustment |

Cream and charcoal reuse Catch's production values. CreamHighlight, tileLine and microLine apply only to Throw icon artwork. They do not prescribe new UI backgrounds, project colors or controls.

## Channel palettes

Every listed gradient color has alpha 1; attached-shadow alpha is 0.14. No additional blending mode, hidden opacity multiplier or overlay is used. All paint interpolation and filter interpolation use sRGB. The complete machine values are in each channel's token file.

### Stable

| Semantic name | HEX | RGB | Alpha | Usage |
|---|---|---|---:|---|
| backgroundStart | `#34D5B5` | 52, 213, 181 | 1 | stable background gradient stop at 0% |
| backgroundMid | `#20AE96` | 32, 174, 150 | 1 | stable background gradient stop at 55% |
| backgroundEnd | `#179A86` | 23, 154, 134 | 1 | stable background gradient stop at 100% |
| ribbonUpperStart | `#32BFA7` | 50, 191, 167 | 1 | stable ribbonUpper gradient stop at 0% |
| ribbonUpperMid | `#B9FFE6` | 185, 255, 230 | 1 | stable ribbonUpper gradient stop at 48% |
| ribbonUpperEnd | `#55D6B8` | 85, 214, 184 | 1 | stable ribbonUpper gradient stop at 100% |
| ribbonLowerStart | `#20AE96` | 32, 174, 150 | 1 | stable ribbonLower gradient stop at 0% |
| ribbonLowerMid | `#82EBD0` | 130, 235, 208 | 1 | stable ribbonLower gradient stop at 52% |
| ribbonLowerEnd | `#33BDA3` | 51, 189, 163 | 1 | stable ribbonLower gradient stop at 100% |
| projectAccentStart | `#34DDBA` | 52, 221, 186 | 1 | stable projectAccent gradient stop at 0% |
| projectAccentMid | `#20AE96` | 32, 174, 150 | 1 | stable projectAccent gradient stop at 55% |
| projectAccentEnd | `#119F88` | 17, 159, 136 | 1 | stable projectAccent gradient stop at 100% |
| tileShadow | `#075B52` | 7, 91, 82 | 0.14 | tile-attached primary shadow only |
| microUpper | `#A0F2D8` | 160, 242, 216 | 1 | stable micro ribbon flat fill |
| microLower | `#72DBC1` | 114, 219, 193 | 1 | stable micro ribbon flat fill |

### Preview

| Semantic name | HEX | RGB | Alpha | Usage |
|---|---|---|---:|---|
| backgroundStart | `#6654B0` | 102, 84, 176 | 1 | preview background gradient stop at 0% |
| backgroundMid | `#504389` | 80, 67, 137 | 1 | preview background gradient stop at 55% |
| backgroundEnd | `#363166` | 54, 49, 102 | 1 | preview background gradient stop at 100% |
| ribbonUpperStart | `#8272C5` | 130, 114, 197 | 1 | preview ribbonUpper gradient stop at 0% |
| ribbonUpperMid | `#DBD3FF` | 219, 211, 255 | 1 | preview ribbonUpper gradient stop at 48% |
| ribbonUpperEnd | `#A798E0` | 167, 152, 224 | 1 | preview ribbonUpper gradient stop at 100% |
| ribbonLowerStart | `#6654B0` | 102, 84, 176 | 1 | preview ribbonLower gradient stop at 0% |
| ribbonLowerMid | `#B6A7EB` | 182, 167, 235 | 1 | preview ribbonLower gradient stop at 52% |
| ribbonLowerEnd | `#8171C0` | 129, 113, 192 | 1 | preview ribbonLower gradient stop at 100% |
| projectAccentStart | `#9683D8` | 150, 131, 216 | 1 | preview projectAccent gradient stop at 0% |
| projectAccentMid | `#6654B0` | 102, 84, 176 | 1 | preview projectAccent gradient stop at 55% |
| projectAccentEnd | `#504389` | 80, 67, 137 | 1 | preview projectAccent gradient stop at 100% |
| tileShadow | `#18122E` | 24, 18, 46 | 0.14 | tile-attached primary shadow only |
| microUpper | `#D7CDFA` | 215, 205, 250 | 1 | preview micro ribbon flat fill |
| microLower | `#B3A3E6` | 179, 163, 230 | 1 | preview micro ribbon flat fill |

### Dev

| Semantic name | HEX | RGB | Alpha | Usage |
|---|---|---|---:|---|
| backgroundStart | `#9AD6FA` | 154, 214, 250 | 1 | dev background gradient stop at 0% |
| backgroundMid | `#69B3F4` | 105, 179, 244 | 1 | dev background gradient stop at 55% |
| backgroundEnd | `#3C86EC` | 60, 134, 236 | 1 | dev background gradient stop at 100% |
| ribbonUpperStart | `#76BBEF` | 118, 187, 239 | 1 | dev ribbonUpper gradient stop at 0% |
| ribbonUpperMid | `#E0F5FF` | 224, 245, 255 | 1 | dev ribbonUpper gradient stop at 48% |
| ribbonUpperEnd | `#B1E0FB` | 177, 224, 251 | 1 | dev ribbonUpper gradient stop at 100% |
| ribbonLowerStart | `#69B3F4` | 105, 179, 244 | 1 | dev ribbonLower gradient stop at 0% |
| ribbonLowerMid | `#BDE8FF` | 189, 232, 255 | 1 | dev ribbonLower gradient stop at 52% |
| ribbonLowerEnd | `#78BBEF` | 120, 187, 239 | 1 | dev ribbonLower gradient stop at 100% |
| projectAccentStart | `#9AD6FA` | 154, 214, 250 | 1 | dev projectAccent gradient stop at 0% |
| projectAccentMid | `#69B3F4` | 105, 179, 244 | 1 | dev projectAccent gradient stop at 55% |
| projectAccentEnd | `#3C86EC` | 60, 134, 236 | 1 | dev projectAccent gradient stop at 100% |
| tileShadow | `#225E92` | 34, 94, 146 | 0.14 | tile-attached primary shadow only |
| microUpper | `#DAF1FE` | 218, 241, 254 | 1 | dev micro ribbon flat fill |
| microLower | `#B4DFFD` | 180, 223, 253 | 1 | dev micro ribbon flat fill |

## Stop positions and direction

- Background: upper-left `(0,0)` to lower-right `(1024,1024)`, stops 0%, 55%, 100%.
- Upper ribbon: `(36,916)` to `(690,340)`, stops 0%, 48%, 100%.
- Lower ribbon: `(60,950)` to `(750,565)`, stops 0%, 52%, 100%.
- Internal square: tile-local `(-114,-126)` to `(4,-8)`, stops 0%, 55%, 100%.
- Tile: tile-local `(-182,-192)` to `(182,192)`, creamHighlight at 0%, cream at 100%; inherited unchanged across treatments.

“Start/Mid/End” suffixes refer to the above role-specific stops. Gradient vectors are in shared tokens; per-channel files reference their semantic gradient IDs.

## Scope and source decisions

Stable uses the agreed #20AE96 primary jade anchor. The final light stop #34D5B5 is slightly brighter than the provisional #34CDB2 to better match the approved upper-left light, with #179A86 providing restrained depth. This is deliberately lighter and simpler than the reference's darker right-edge shading.

Preview background #6654B0 / #504389 / #363166 reuses the saved Catch preview token file. Catch's externally corrected current repository artwork was not supplied; this package does not claim those saved values are the current external implementation. Dev background #9AD6FA / #69B3F4 / #3C86EC reuses the saved Catch dev convention. Both treatments recolor Throw's ribbons and internal square coherently while keeping every contour and neutral detail unchanged.

Small sources omit the attached shadow and use a flat cream tile. Micro sources also replace ribbon/square gradients with explicit role-specific flat colors; the square uses projectAccentMid. No channel geometry variation, badge or label exists. Shared monochrome marks and themed icons intentionally have no channel differentiation.

Do not merge these paint overrides into an application theme. No UI token inheritance or theme replacement is prescribed. Any future alignment to a changed Catch channel convention must be an explicit update to Throw's channel tokens followed by regeneration and visual checks.
