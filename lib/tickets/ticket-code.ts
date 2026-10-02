import { randomBytes } from "crypto";

/** Longitud en bytes del token aleatorio (24 → ~32 chars base64url). */
const CODIGO_BYTES = 24;

/**
 * Genera un código público opaco con CSPRNG (no usar Math.random).
 * Independiente de numeroVisible / fecha / timestamp.
 */
export function generarCodigoPublico(): string {
  return randomBytes(CODIGO_BYTES).toString("base64url");
}
