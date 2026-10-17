# Marca — Lotería La Jungla

## Recursos de producción

| Archivo | Uso |
|---|---|
| `logo-transparent.png` | Emblema oficial con canal alfa (UI + ticket PNG) |
| `logo-source-v2.jpg` | Fuente JPEG original (940×1024; no usar en UI) |
| `favicon-32.png` | Favicon 32×32 |
| `icon-192.png` / `icon-512.png` | PWA / metadatos |
| `apple-touch-icon.png` | Apple touch 180×180 |

`app/icon.png` y `app/apple-icon.png` derivan de estos mismos PNG (convención Next.js).

## Regenerar (solo si cambia la fuente)

No hace falta para el runtime. Los scripts viven en `scripts/` y usan dependencias **locales temporales** (no van en `package.json` de producción):

```bash
npm install --no-save jpeg-js@0.4.4 pngjs@7.0.0
node scripts/_make-logo-transparent.mjs
node scripts/_make-brand-icons.mjs
```

Versiones comprobadas: `jpeg-js@0.4.4`, `pngjs@7.0.0`.
