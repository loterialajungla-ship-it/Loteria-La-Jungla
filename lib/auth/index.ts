/**
 * Autenticación Lotería La Jungla
 *
 * Único sistema: Usuario + passwordHash + UsuarioSesion + cookie lj_session
 * Bootstrap (script aislado): ADMIN_BOOTSTRAP_USER + ADMIN_BOOTSTRAP_PASSWORD
 *
 * Pendiente: rate limit de login; CSRF más estricto si hace falta (hoy SameSite=Lax).
 */

export {
  COOKIE_LJ_SESSION,
  sessionHours,
  sessionMaxAgeSeconds,
  PASSWORD_MIN_LENGTH,
  bootstrapAdminUser,
  bootstrapAdminPassword,
} from "@/lib/auth/constants";

export {
  hashPassword,
  verifyPassword,
  assertPasswordPolicy,
  PasswordValidationError,
} from "@/lib/auth/password";

export {
  generateSessionToken,
  hashSessionToken,
} from "@/lib/auth/tokens";

export {
  createSession,
  resolveSessionByToken,
  deleteSessionByToken,
} from "@/lib/auth/session";
export type { AuthUser, CreateSessionResult, SessionRecord } from "@/lib/auth/session";

export {
  getCurrentUser,
  getAuthContext,
} from "@/lib/auth/current-user";

export {
  requireAdmin,
  requireVendorOrAdmin,
  requireAuthenticatedUser,
  assertRole,
} from "@/lib/auth/guards";
export type { AdminActor, VendorOrAdminActor } from "@/lib/auth/guards";

export {
  AuthError,
  UnauthorizedError,
  ForbiddenError,
  UserValidationError,
  UserConflictError,
  UserNotFoundError,
  UserStateConflictError,
} from "@/lib/auth/errors";

export {
  loginWithCredentials,
  redirectPathForRole,
} from "@/lib/auth/login";
export type { LoginSuccess } from "@/lib/auth/login";

export {
  setLjSessionCookie,
  clearLjSessionCookie,
  ljSessionCookieOptions,
} from "@/lib/auth/cookies";

export {
  changeOwnPassword,
  resetVendorPassword,
  parseChangePasswordBody,
  parseResetPasswordBody,
} from "@/lib/auth/password-management";

export {
  normalizeUsuario,
  isValidUsuarioFormat,
  USUARIO_MIN_LENGTH,
  USUARIO_MAX_LENGTH,
} from "@/lib/auth/username";
