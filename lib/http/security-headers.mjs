/**
 * Cabeceras HTTP de seguridad (B5.6-C) — fuente usada por `next.config.mjs`.
 * La API tipada vive en `security-headers.ts` (reexporta estos valores).
 *
 * CSP de bloqueo: NO activa. Ver `CSP_CANDIDATE_DIRECTIVES`.
 */

/** @typedef {{ key: string, value: string }} SecurityHeader */

/** @type {readonly SecurityHeader[]} */
export const ACTIVE_SECURITY_HEADERS = Object.freeze([
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
]);

/**
 * Inventario (código actual):
 * - Scripts/estilos: Next 14 + Tailwind; fuentes Geist locales (`next/font/local`).
 * - Imágenes: `/brand/*`, `/animals/*`; QR canvas; PNG con `blob:` (html-to-image).
 * - connect: fetch same-origin `/api/*`; sin WebSocket.
 * - Forms: POST same-origin. Sin iframes, CDNs ni eval de app.
 *
 * No se activa en respuestas: Next inyecta inline sin nonces verificados aquí.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CSP_CANDIDATE_DIRECTIVES = Object.freeze({
  "default-src": "'self'",
  "base-uri": "'self'",
  "object-src": "'none'",
  "frame-ancestors": "'none'",
  "form-action": "'self'",
  "frame-src": "'none'",
  "script-src": "'self'",
  "style-src": "'self'",
  "img-src": "'self' data: blob:",
  "font-src": "'self'",
  "connect-src": "'self'",
  "worker-src": "'self' blob:",
});

/** @param {Readonly<Record<string, string>>} [directives] */
export function buildCspCandidateHeaderValue(
  directives = CSP_CANDIDATE_DIRECTIVES,
) {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

/** Propuesta futura (HTTPS verificado); no enviada. */
export const HSTS_RECOMMENDATION =
  "Strict-Transport-Security: max-age=31536000; includeSubDomains";
