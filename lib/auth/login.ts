import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, type AuthUser } from "@/lib/auth/session";
import { normalizeUsuario } from "@/lib/auth/username";
import { recordAuthAuditBestEffort } from "@/lib/audit/audit";

type Db = Pick<PrismaClient, "usuario" | "usuarioSesion" | "auditoria">;

export type LoginSuccess = {
  user: AuthUser;
  token: string;
  expiresAt: Date;
};

/**
 * Login por Usuario.usuario + contraseña.
 * Mensaje genérico en fallo (no revelar si el usuario existe).
 * No loguea contraseñas.
 */
export async function loginWithCredentials(
  db: Db,
  args: { usuario: string; password: string },
  ahora = new Date(),
): Promise<LoginSuccess | null> {
  const usuarioLogin = normalizeUsuario(args.usuario);
  if (!usuarioLogin || !args.password) {
    return null;
  }

  const row = await db.usuario.findUnique({
    where: { usuario: usuarioLogin },
    select: {
      id: true,
      nombre: true,
      usuario: true,
      rol: true,
      activo: true,
      passwordHash: true,
    },
  });

  if (!row || !row.activo) {
    return null;
  }

  const ok = await verifyPassword(args.password, row.passwordHash);
  if (!ok) return null;

  const { token, expiresAt } = await createSession(db, row.id, ahora);

  await db.usuario.update({
    where: { id: row.id },
    data: { lastLoginAt: ahora },
  });

  // LOGIN: best-effort (fuera de TX de sesión). No revierte el login si falla.
  // No guarda IP, user-agent, token ni password.
  await recordAuthAuditBestEffort(db, {
    usuarioId: row.id,
    accion: "LOGIN",
    entidad: "AUTH",
    entidadId: row.id,
    detalle: { evento: "login" },
  });

  return {
    user: {
      id: row.id,
      nombre: row.nombre,
      usuario: row.usuario,
      rol: row.rol,
      activo: row.activo,
    },
    token,
    expiresAt,
  };
}

export function redirectPathForRole(rol: AuthUser["rol"]): string {
  return rol === "VENDEDOR" ? "/venta" : "/admin";
}
