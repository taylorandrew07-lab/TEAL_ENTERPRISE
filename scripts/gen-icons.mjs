// Generates the PWA / favicon icons (an indigo "T" mark, matching the header brand
// mark) from inline SVG via sharp. Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = '#4f46e5'; // indigo — matches --primary in app/globals.css

// t: 'normal' (centered, fills more) | 'safe' (smaller, inside maskable safe zone)
function svg({ rounded, t }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${BRAND}"/>`
    : `<rect width="512" height="512" fill="${BRAND}"/>`;
  const T =
    t === 'safe'
      ? `<rect x="164" y="168" width="184" height="48" rx="8" fill="#fff"/><rect x="232" y="168" width="48" height="176" rx="8" fill="#fff"/>`
      : `<rect x="136" y="146" width="240" height="60" rx="10" fill="#fff"/><rect x="226" y="146" width="60" height="220" rx="10" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${bg}${T}</svg>`;
}

const rounded = Buffer.from(svg({ rounded: true, t: 'normal' }));
const square = Buffer.from(svg({ rounded: false, t: 'normal' }));
const maskable = Buffer.from(svg({ rounded: false, t: 'safe' }));

mkdirSync(resolve(root, 'public'), { recursive: true });

const targets = [
  [rounded, 192, 'public/icon-192.png'],
  [rounded, 512, 'public/icon-512.png'],
  [maskable, 512, 'public/icon-maskable-512.png'],
  [rounded, 256, 'app/icon.png'], // favicon (Next convention)
  [square, 180, 'app/apple-icon.png'], // apple-touch-icon (Next convention)
];

for (const [buf, size, path] of targets) {
  await sharp(buf).resize(size, size).png().toFile(resolve(root, path));
  console.log('wrote', path, `(${size}x${size})`);
}
