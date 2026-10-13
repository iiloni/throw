import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';

const channels = ['stable', 'preview', 'dev'] as const;

test('ICO frames use the assigned display-size tiers and retain transparent corners', async () => {
  for (const channel of channels) {
    const base = `apps/web/public${channel === 'stable' ? '' : `/${channel}`}`;
    const ico = await readFile(`${base}/favicon.ico`);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      assert.equal(ico[entry], size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const frame = ico.subarray(offset, offset + length);
      assert.deepEqual(frame, await readFile(`${base}/favicon-${size}x${size}.png`));
      const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, size);
      assert.equal(info.height, size);
      assert.equal(info.channels, 4);
      assert.equal(data[3], 0);
    }
  }
});

test('maskable and Apple icons are full bleed; adaptive and themed ink stays in the 66 dp safe circle', async () => {
  for (const channel of channels) {
    const base = `apps/web/public${channel === 'stable' ? '' : `/${channel}`}`;
    for (const file of ['maskable-512x512.png', 'apple-touch-icon.png']) {
      const { data } = await sharp(`${base}/${file}`).raw().toBuffer({ resolveWithObject: true });
      for (let index = 3; index < data.length; index += 4) assert.equal(data[index], 255);
    }
    const native = `branding/android/app/src/${channel === 'stable' ? 'main' : channel}/res`;
    const sources = [`${native}/mipmap-xhdpi/ic_launcher_foreground.png`];
    if (channel === 'stable') sources.push(`${native}/mipmap-xhdpi/ic_launcher_monochrome.png`);
    for (const source of sources) {
      const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 216);
      assert.equal(info.height, 216);
      assert.equal(info.channels, 4);
      let painted = 0;
      for (let y = 0; y < 216; y++) {
        for (let x = 0; x < 216; x++) {
          if (data[(y * 216 + x) * 4 + 3]! <= 1) continue;
          painted++;
          assert(
            Math.hypot(x + 0.5 - 108, y + 0.5 - 108) < 66,
            `Ink outside adaptive safe zone: ${source}`,
          );
        }
      }
      assert(painted > 1000, `Foreground must contain artwork: ${source}`);
    }
  }
});

test('the shared Android monochrome keeps transparent project-detail knockouts', async () => {
  const { data } = await sharp(
    'branding/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.png',
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Tile-local accent/line centers transformed by the canonical 16° rotation and
  // the supplied adaptive matrix, then mapped to the full 108 dp layer at 4×.
  for (const [localX, localY] of [
    [-55, -67],
    [4, 70],
  ]) {
    const radians = (16 * Math.PI) / 180;
    const x = 732 + localX! * Math.cos(radians) - localY! * Math.sin(radians);
    const y = 459 + localX! * Math.sin(radians) + localY! * Math.cos(radians);
    const px = Math.floor(((0.55 * x + 241.95) * 432) / 1024);
    const py = Math.floor(((0.55 * y + 189.7) * 432) / 1024);
    assert.equal(data[(py * 432 + px) * 4 + 3], 0);
  }
});
