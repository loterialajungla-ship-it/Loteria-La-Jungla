/**
 * API tipada de cabeceras de seguridad (B5.6-C).
 * Implementación compartida con Next: `security-headers.mjs`.
 */
export type SecurityHeader = { key: string; value: string };

// Reexport desde .mjs (fuente única consumida también por next.config.mjs).
export {
  ACTIVE_SECURITY_HEADERS,
  CSP_CANDIDATE_DIRECTIVES,
  HSTS_RECOMMENDATION,
  buildCspCandidateHeaderValue,
} from "./security-headers.mjs";
