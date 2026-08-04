// One-shot PWA icon generator. Run from repo root: `node scripts/generate-pwa-icons.mjs`.
// Rasterizes public/confluencex-mark.svg at all PWA-required sizes into public/icons/.
// Outputs:
//   - Standard icons (any): the SVG rendered at the target size with its own background
//   - Maskable icons (192, 512): the SVG mark scaled to 80% centered on a solid #070a12
//     background so it survives circular / squircle / rounded-square launcher masks.
//   - Shortcut icons (96): the same SVG at 96x96 with purpose=any
//   - favicon-32, apple-touch-icon-180: standard rasterizations
//
// Inputs: public/confluencex-mark.svg (128 viewBox, already edge-to-edge background)

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const svgPath = join(repoRoot, 'public', 'confluencex-mark.svg');
const outDir = join(repoRoot, 'public', 'icons');

const MASK_BG = '#070a12'; // matches manifest background_color
const MASK_SAFE = 0.8; // center 80% safe zone

const targets = [
  { size: 32, name: 'favicon-32.png', maskable: false },
  { size: 72, name: 'icon-72.png', maskable: false },
  { size: 96, name: 'icon-96.png', maskable: false },
  { size: 128, name: 'icon-128.png', maskable: false },
  { size: 144, name: 'icon-144.png', maskable: false },
  { size: 152, name: 'icon-152.png', maskable: false },
  { size: 180, name: 'apple-touch-icon.png', maskable: false },
  { size: 192, name: 'icon-192.png', maskable: false },
  { size: 192, name: 'icon-maskable-192.png', maskable: true },
  { size: 384, name: 'icon-384.png', maskable: false },
  { size: 512, name: 'icon-512.png', maskable: false },
  { size: 512, name: 'icon-maskable-512.png', maskable: true },
  { size: 96, name: 'shortcut-scanner.png', maskable: false },
  { size: 96, name: 'shortcut-chart.png', maskable: false },
  { size: 96, name: 'shortcut-signals.png', maskable: false },
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function buildMaskable(svgBuf, size) {
  const inner = Math.round(size * MASK_SAFE);
  const innerBuf = await sharp(svgBuf, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: MASK_BG })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: MASK_BG,
    },
  })
    .composite([{ input: innerBuf, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function buildStandard(svgBuf, size) {
  return sharp(svgBuf, { density: 384 })
    .resize(size, size, { fit: 'contain', background: MASK_BG })
    .png()
    .toBuffer();
}

async function main() {
  if (!(await exists(svgPath))) {
    console.error('Missing source SVG:', svgPath);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  const svgBuf = await readFile(svgPath);

  for (const t of targets) {
    const out =
      t.name === 'apple-touch-icon.png'
        ? join(repoRoot, 'public', t.name)
        : join(outDir, t.name);
    const buf = t.maskable
      ? await buildMaskable(svgBuf, t.size)
      : await buildStandard(svgBuf, t.size);
    await writeFile(out, buf);
    console.log(`wrote ${out} (${t.size}x${t.size}${t.maskable ? ' maskable' : ''})`);
  }

  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
