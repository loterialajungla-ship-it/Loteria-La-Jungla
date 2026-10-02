/**
 * Normalización de login: trim + minúsculas.
 * Debe usarse en creación, bootstrap helper y login.
 */
export const USUARIO_MIN_LENGTH = 3;
export const USUARIO_MAX_LENGTH = 32;
export const NOMBRE_MIN_LENGTH = 2;
export const NOMBRE_MAX_LENGTH = 80;

export function normalizeUsuario(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Letras, números, punto, guion y guion bajo. */
const USUARIO_RE = /^[a-z0-9._-]+$/;

export function isValidUsuarioFormat(usuario: string): boolean {
  return (
    usuario.length >= USUARIO_MIN_LENGTH &&
    usuario.length <= USUARIO_MAX_LENGTH &&
    USUARIO_RE.test(usuario)
  );
}
