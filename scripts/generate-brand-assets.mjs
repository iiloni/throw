import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = resolve(root, 'throw-brand');
const check = process.argv.includes('--check');
assert(
  process.argv.slice(2).every((arg) => arg === '--check'),
  'Usage: node scripts/generate-brand-assets.mjs [--check]',
);

// The supplied package is immutable provenance. This also guards exported SVGs before
// copying them, without requiring Python in the development/build containers.
const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'package-manifest.json'), 'utf8'));
for (const [path, entry] of Object.entries(manifest.files)) {
  const bytes = await readFile(resolve(sourceRoot, path));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    entry.sha256,
    `Brand source changed: ${path}; review and regenerate its integrity manifest first.`,
  );
}

let count = 0;
async function output(path, bytes) {
  const destination = resolve(root, path);
  const expected = Buffer.from(bytes);
  if (check) {
    assert.deepEqual(await readFile(destination), expected, `Generated asset differs: ${path}`);
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, expected);
  }
  count++;
}

async function copy(source, destination) {
  await output(destination, await readFile(resolve(sourceRoot, source)));
}

async function render(source, size) {
  // librsvg preserves the supplied sRGB gradients, filters and luminance masks.
  // Render directly at the target resolution; density never selects a detail tier.
  return sharp(await readFile(resolve(sourceRoot, source)))
    .resize(size, size)
    .ensureAlpha()
    .png()
    .toBuffer();
}

// PNG-backed ICO frames preserve alpha, including the rounded tile's corners.
function ico(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (const [index, { size, bytes }] of frames.entries()) {
    const entry = 6 + index * 16;
    header[entry] = size;
    header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  }
  return Buffer.concat([header, ...frames.map(({ bytes }) => bytes)]);
}

const densities = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
const nativeRoot = 'branding/android/app/src';
for (const channel of ['stable', 'preview', 'dev']) {
  const publicRoot = `apps/web/public${channel === 'stable' ? '' : `/${channel}`}`;
  const native = `${nativeRoot}/${channel === 'stable' ? 'main' : channel}/res`;
  const primary = `${channel}/throw-icon-${channel}.svg`;
  const small = `${channel}/throw-icon-${channel}-small.svg`;
  const micro = `${channel}/throw-favicon-${channel}.svg`;
  const maskable = `${channel}/throw-maskable-${channel}.svg`;
  await copy(primary, `${publicRoot}/icon.svg`);
  await copy(small, `${publicRoot}/icon-small.svg`);
  await copy(micro, `${publicRoot}/favicon-mark.svg`);
  const favicon = ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        bytes: await render(size < 48 ? micro : small, size),
      })),
    ),
  );
  await output(`${publicRoot}/favicon.ico`, favicon);
  // Tools that list repositories look for an icon at the root; it identifies the product.
  if (channel === 'stable') await output('favicon.ico', favicon);
  for (const size of [16, 24, 32, 48]) {
    await output(
      `${publicRoot}/favicon-${size}x${size}.png`,
      await render(size < 48 ? micro : small, size),
    );
  }
  for (const size of [192, 512]) {
    await output(`${publicRoot}/pwa-${size}x${size}.png`, await render(primary, size));
  }
  // Apple supplies its own mask; use full bleed rather than another rounded square.
  await output(`${publicRoot}/apple-touch-icon.png`, await render(maskable, 180));
  await output(`${publicRoot}/maskable-512x512.png`, await render(maskable, 512));

  for (const orientation of ['horizontal', 'stacked']) {
    for (const ink of ['dark', 'light']) {
      for (const suffix of ['', '-small', '-micro']) {
        const name = `throw-lockup-${orientation}-${channel}-${ink}${suffix}.svg`;
        await copy(`wordmarks/${channel}/${name}`, `apps/web/public/wordmarks/${name}`);
      }
    }
  }

  for (const [density, scale] of densities) {
    const mipmap = `${native}/mipmap-${density}`;
    // The legacy launcher displays a 48 dp icon at every density: always small-tier.
    await output(`${mipmap}/ic_launcher.png`, await render(small, 48 * scale));
    // The sources already contain their safe-zone transform. Map the entire canvas to
    // 108 dp; AdaptiveIconDrawable applies its own mask and viewport.
    for (const layer of ['foreground', 'background']) {
      await output(
        `${mipmap}/ic_launcher_${layer}.png`,
        await render(`${channel}/throw-adaptive-${layer}-${channel}.svg`, 108 * scale),
      );
    }
    if (channel === 'stable') {
      await output(
        `${mipmap}/ic_launcher_monochrome.png`,
        await render('shared/throw-adaptive-monochrome.svg', 108 * scale),
      );
    }
  }
}

for (const ink of ['dark', 'light']) {
  await copy(
    `wordmarks/throw-wordmark-${ink}.svg`,
    `apps/web/public/wordmarks/throw-wordmark-${ink}.svg`,
  );
  await copy(`shared/throw-mark-mono-${ink}.svg`, `apps/web/public/throw-mark-mono-${ink}.svg`);
}
for (const version of [26, 33]) {
  await output(
    `${nativeRoot}/main/res/mipmap-anydpi-v${version}/ic_launcher.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />${version === 33 ? '\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />' : ''}
</adaptive-icon>
`,
  );
}
console.log(
  `${check ? 'Verified' : 'Generated'} ${count} platform assets with sharp ${sharp.versions.sharp}, librsvg ${sharp.versions.rsvg}.`,
);
