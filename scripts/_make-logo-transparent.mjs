/**
 * Genera logo-transparent.png eliminando el damero JPEG (sin canal alfa).
 * Uso: node scripts/_make-logo-transparent.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "public", "brand", "logo-source-v2.jpg");
const outPath = path.join(root, "public", "brand", "logo-transparent.png");

const decoded = jpeg.decode(fs.readFileSync(srcPath), { useTArray: true });
const { width, height, data } = decoded;
const n = width * height;

/** Damero: ~#C8 / ~#FF, croma bajo. No usa umbral global sobre grises internos. */
function checkerLikeness(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const avg = (r + g + b) / 3;
  if (chroma > 16) return 0;
  if (avg < 175) return 0;
  const dTile = Math.min(Math.abs(avg - 201), Math.abs(avg - 254));
  if (dTile <= 10 && chroma <= 12) return 1;
  if (dTile <= 28 && chroma <= 16) return 0.55;
  return 0;
}

const likeness = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const o = i * 4;
  likeness[i] = checkerLikeness(data[o], data[o + 1], data[o + 2]);
}

const isBg = new Uint8Array(n);
const queue = new Int32Array(n);
let qh = 0;
let qt = 0;

function seed(i) {
  if (isBg[i] || likeness[i] < 0.5) return;
  isBg[i] = 1;
  queue[qt++] = i;
}

for (let x = 0; x < width; x++) {
  seed(x);
  seed((height - 1) * width + x);
}
for (let y = 0; y < height; y++) {
  seed(y * width);
  seed(y * width + (width - 1));
}

while (qh < qt) {
  const i = queue[qh++];
  const x = i % width;
  const y = (i / width) | 0;
  const neighbors = [];
  if (x > 0) neighbors.push(i - 1);
  if (x < width - 1) neighbors.push(i + 1);
  if (y > 0) neighbors.push(i - width);
  if (y < height - 1) neighbors.push(i + width);
  for (const j of neighbors) {
    if (isBg[j]) continue;
    if (likeness[j] < 0.45) continue;
    isBg[j] = 1;
    queue[qt++] = j;
  }
}

/** Limpieza: islas grises del damero no alcanzadas por el BFS estricto. */
function softChecker(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const avg = (r + g + b) / 3;
  return chroma <= 28 && avg >= 165;
}

for (let pass = 0; pass < 4; pass++) {
  let grew = 0;
  for (let i = 0; i < n; i++) {
    if (isBg[i]) continue;
    const o = i * 4;
    if (!softChecker(data[o], data[o + 1], data[o + 2])) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let near = 0;
    if (x > 0 && isBg[i - 1]) near++;
    if (x < width - 1 && isBg[i + 1]) near++;
    if (y > 0 && isBg[i - width]) near++;
    if (y < height - 1 && isBg[i + width]) near++;
    // También diagonales en pasadas posteriores
    if (pass > 0) {
      if (x > 0 && y > 0 && isBg[i - width - 1]) near++;
      if (x < width - 1 && y > 0 && isBg[i - width + 1]) near++;
      if (x > 0 && y < height - 1 && isBg[i + width - 1]) near++;
      if (x < width - 1 && y < height - 1 && isBg[i + width + 1]) near++;
    }
    if (near >= 1) {
      isBg[i] = 1;
      grew++;
    }
  }
  if (grew === 0) break;
}

const alpha = new Uint8ClampedArray(n);
for (let i = 0; i < n; i++) {
  if (isBg[i]) {
    const o = i * 4;
    const soft = softChecker(data[o], data[o + 1], data[o + 2]);
    if (likeness[i] >= 0.55 || soft) {
      alpha[i] = 0;
    } else {
      alpha[i] = Math.round((1 - Math.max(likeness[i], 0.35)) * 255);
    }
    continue;
  }

  const x = i % width;
  const y = (i / width) | 0;
  let nearBg = false;
  if (x > 0 && isBg[i - 1]) nearBg = true;
  else if (x < width - 1 && isBg[i + 1]) nearBg = true;
  else if (y > 0 && isBg[i - width]) nearBg = true;
  else if (y < height - 1 && isBg[i + width]) nearBg = true;

  if (!nearBg) {
    alpha[i] = 255;
    continue;
  }

  const o = i * 4;
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const avg = (r + g + b) / 3;
  if (chroma < 40 && avg > 155) {
    const d = Math.min(Math.abs(avg - 201), Math.abs(avg - 250));
    const mix = Math.min(
      1,
      Math.max(0, (1 - (chroma - 6) / 36) * (1 - d / 60)),
    );
    alpha[i] = Math.round((1 - mix * 0.95) * 255);
  } else {
    alpha[i] = 255;
  }
}

const png = new PNG({ width, height });
let transparent = 0;
let opaque = 0;
for (let i = 0; i < n; i++) {
  const o = i * 4;
  png.data[o] = data[o];
  png.data[o + 1] = data[o + 1];
  png.data[o + 2] = data[o + 2];
  png.data[o + 3] = alpha[i];
  if (alpha[i] === 0) transparent++;
  else if (alpha[i] === 255) opaque++;
}

const corners = [
  [0, 0],
  [width - 1, 0],
  [0, height - 1],
  [width - 1, height - 1],
  [40, 40],
  [120, 120],
  [width - 40, 40],
  [470, 512],
];

fs.writeFileSync(outPath, PNG.sync.write(png));
console.log(
  JSON.stringify(
    {
      outPath,
      width,
      height,
      bytes: fs.statSync(outPath).size,
      bgCount: qt,
      transparent,
      opaque,
      partial: n - transparent - opaque,
      cornerAlpha: corners.map(([x, y]) => ({
        x,
        y,
        a: alpha[y * width + x],
      })),
    },
    null,
    2,
  ),
);
