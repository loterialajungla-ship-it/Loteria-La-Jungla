/**
 * Deriva favicons/iconos desde logo-transparent.png (encuadre al emblema).
 * Uso: node scripts/_make-brand-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = PNG.sync.read(
  fs.readFileSync(path.join(root, "public", "brand", "logo-transparent.png")),
);
const { width: sw, height: sh, data } = src;

let minX = sw;
let minY = sh;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < sh; y++) {
  for (let x = 0; x < sw; x++) {
    if (data[(y * sw + x) * 4 + 3] > 128) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(sw - 1, maxX + pad);
maxY = Math.min(sh - 1, maxY + pad);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const side = Math.max(cw, ch);

function sample(sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const p = (x, y) => {
    const i = (y * sw + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const a = p(x0, y0);
  const b = p(x1, y0);
  const c = p(x0, y1);
  const d = p(x1, y1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    out[k] = Math.round(
      a[k] * (1 - fx) * (1 - fy) +
        b[k] * fx * (1 - fy) +
        c[k] * (1 - fx) * fy +
        d[k] * fx * fy,
    );
  }
  return out;
}

function writeIcon(size, outFile, { scaleUp = 1.02 } = {}) {
  const out = new PNG({ width: size, height: size });
  const fit = (size / side) * scaleUp;
  const ox = (size - cw * fit) / 2;
  const oy = (size - ch * fit) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = minX + (x - ox) / fit;
      const sy = minY + (y - oy) / fit;
      const i = (y * size + x) * 4;
      if (sx < minX || sy < minY || sx > maxX || sy > maxY) {
        out.data[i + 3] = 0;
        continue;
      }
      const [r, g, b, a] = sample(sx, sy);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    }
  }
  fs.writeFileSync(outFile, PNG.sync.write(out));
  return { outFile, size, bytes: fs.statSync(outFile).size };
}

const brand = path.join(root, "public", "brand");
const results = [
  writeIcon(32, path.join(brand, "favicon-32.png"), { scaleUp: 1.06 }),
  writeIcon(180, path.join(brand, "apple-touch-icon.png")),
  writeIcon(192, path.join(brand, "icon-192.png")),
  writeIcon(512, path.join(brand, "icon-512.png")),
  writeIcon(192, path.join(root, "app", "icon.png")),
  writeIcon(180, path.join(root, "app", "apple-icon.png")),
];

console.log(
  JSON.stringify(
    { bbox: { minX, minY, maxX, maxY, cw, ch, side }, results },
    null,
    2,
  ),
);
