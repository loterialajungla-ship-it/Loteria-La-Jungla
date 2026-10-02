/**
 * Reglas de autorización UI/API (espejo de layouts + guards).
 * Única fuente: UsuarioSesion / lj_session. Sin legacy.
 */

import type { AuthUser } from "@/lib/auth/session";

export type UiAuthResult =
  | { ok: true }
  | { ok: false; redirect: "/login" | "/venta" };

/** Espejo de app/admin/layout.tsx */
export function authorizeAdminUi(user: AuthUser | null): UiAuthResult {
  if (user?.rol === "VENDEDOR") {
    return { ok: false, redirect: "/venta" };
  }
  if (user?.rol === "ADMIN") {
    return { ok: true };
  }
  return { ok: false, redirect: "/login" };
}

/** Espejo de app/venta/layout.tsx */
export function authorizeVentaUi(user: AuthUser | null): UiAuthResult {
  if (user?.rol === "ADMIN" || user?.rol === "VENDEDOR") {
    return { ok: true };
  }
  return { ok: false, redirect: "/login" };
}

/** requireAdmin (API): solo rol ADMIN con sesión. */
export function canAccessAdminApi(user: AuthUser | null): boolean {
  return user?.rol === "ADMIN";
}

/** requireVendorOrAdmin: ADMIN|VENDEDOR con sesión. */
export function canAccessVentaApi(user: AuthUser | null): boolean {
  return user?.rol === "ADMIN" || user?.rol === "VENDEDOR";
}

/** /perfil: ADMIN o VENDEDOR autenticados. */
export function authorizePerfilUi(user: AuthUser | null): UiAuthResult {
  if (user?.rol === "ADMIN" || user?.rol === "VENDEDOR") {
    return { ok: true };
  }
  return { ok: false, redirect: "/login" };
}

/** POST /api/auth/change-password: autenticado ADMIN|VENDEDOR. */
export function canChangeOwnPassword(user: AuthUser | null): boolean {
  return user?.rol === "ADMIN" || user?.rol === "VENDEDOR";
}

/**
 * POST /api/admin/usuarios/[id]/reset-password:
 * actor ADMIN; target VENDEDOR (rol se consulta en DB, no en body).
 */
export function canResetVendorPassword(actor: AuthUser | null): boolean {
  return actor?.rol === "ADMIN";
}

/** /ticket/* es público (fuera del matcher de middleware). */
export function isPublicTicketPath(pathname: string): boolean {
  return pathname === "/ticket" || pathname.startsWith("/ticket/");
}

/**
 * Cookie admin_session / secretos ADMIN_* nunca autorizan.
 * (El mecanismo legacy fue retirado; cualquier valor debe fallar.)
 */
export function legacyCookieGrantsAccess(cookieValue?: string): boolean {
  if (cookieValue === undefined || cookieValue === "") return false;
  return false;
}

export function envSecretAuthenticates(
  kind: "ADMIN_PASSWORD" | "ADMIN_SESSION_SECRET",
): boolean {
  if (kind === "ADMIN_PASSWORD" || kind === "ADMIN_SESSION_SECRET") {
    return false;
  }
  return false;
}
