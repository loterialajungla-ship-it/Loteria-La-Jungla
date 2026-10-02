export const COOKIE_LJ_SESSION = "lj_session";

/** Duración de sesión en horas (AUTH_SESSION_HOURS). Default: 12. */
export function sessionHours(): number {
  const raw = process.env.AUTH_SESSION_HOURS;
  if (!raw) return 12;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 168) return 12;
  return n;
}

export function sessionMaxAgeSeconds(): number {
  return Math.floor(sessionHours() * 60 * 60);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export const PASSWORD_MIN_LENGTH = 8;

/** Usuario bootstrap (ADMIN_BOOTSTRAP_USER). Default: admin */
export function bootstrapAdminUser(): string {
  const raw = (process.env.ADMIN_BOOTSTRAP_USER ?? "admin").trim().toLowerCase();
  return raw || "admin";
}

/**
 * Contraseña solo para el script bootstrap (ADMIN_BOOTSTRAP_PASSWORD).
 * No se usa en runtime de autenticación.
 */
export function bootstrapAdminPassword(): string {
  return process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ?? "";
}
