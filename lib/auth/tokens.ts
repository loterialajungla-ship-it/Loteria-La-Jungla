import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** Token opaco criptográficamente seguro (para cookie). Nunca persistir en claro. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash SHA-256 del token para almacenar/buscar en UsuarioSesion.tokenHash. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
