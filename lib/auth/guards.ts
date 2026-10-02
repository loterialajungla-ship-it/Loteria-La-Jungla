import type { RolUsuario } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ForbiddenError,
  UnauthorizedError,
} from "@/lib/auth/errors";
import type { AuthUser } from "@/lib/auth/session";

export type AdminActor = {
  userId: string;
  source: "session";
  user: AuthUser;
};

export type VendorOrAdminActor = {
  userId: string;
  user: AuthUser;
  source: "session";
};

/**
 * Requiere UsuarioSesion con cualquier rol activo.
 */
export async function requireAuthenticatedUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Solo ADMIN con UsuarioSesion (lj_session).
 * anuladoPorId / actorUserId = user.id.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (user.rol !== "ADMIN") {
    throw new ForbiddenError("Se requiere rol ADMIN.");
  }
  return { userId: user.id, source: "session", user };
}

/**
 * ADMIN o VENDEDOR con UsuarioSesion.
 * No acepta cookies ni secretos legacy.
 */
export async function requireVendorOrAdmin(): Promise<VendorOrAdminActor> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError(
      "Inicia sesión con tu usuario (ADMIN o VENDEDOR).",
    );
  }
  if (user.rol !== "ADMIN" && user.rol !== "VENDEDOR") {
    throw new ForbiddenError();
  }
  return { userId: user.id, user, source: "session" };
}

export function assertRole(
  user: AuthUser,
  roles: RolUsuario[],
): void {
  if (!roles.includes(user.rol)) {
    throw new ForbiddenError("No tienes permiso para esta acción.");
  }
}
