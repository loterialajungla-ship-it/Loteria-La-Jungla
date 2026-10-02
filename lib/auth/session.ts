import type { PrismaClient, RolUsuario } from "@prisma/client";
import { sessionHours } from "@/lib/auth/constants";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";

type Db = Pick<PrismaClient, "usuarioSesion" | "usuario">;

export type AuthUser = {
  id: string;
  nombre: string;
  usuario: string;
  rol: RolUsuario;
  activo: boolean;
};

export type SessionRecord = {
  id: string;
  usuarioId: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
};

/** Intervalo mínimo entre updates de lastUsedAt (evitar write en cada request). */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export type CreateSessionResult = {
  /** Token en claro — solo para cookie. Nunca persistir ni loguear. */
  token: string;
  sessionId: string;
  expiresAt: Date;
};

export async function createSession(
  db: Db,
  usuarioId: string,
  ahora = new Date(),
): Promise<CreateSessionResult> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(
    ahora.getTime() + sessionHours() * 60 * 60 * 1000,
  );

  const session = await db.usuarioSesion.create({
    data: {
      usuarioId,
      tokenHash,
      expiresAt,
      lastUsedAt: ahora,
    },
  });

  return { token, sessionId: session.id, expiresAt };
}

/**
 * Resuelve sesión por token de cookie.
 * - Expirada / inexistente / usuario inactivo → null (y limpia fila expirada).
 * - Actualiza lastUsedAt con throttle.
 */
export async function resolveSessionByToken(
  db: Db,
  token: string | undefined | null,
  ahora = new Date(),
): Promise<{ user: AuthUser; session: SessionRecord } | null> {
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const session = await db.usuarioSesion.findUnique({
    where: { tokenHash },
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          usuario: true,
          rol: true,
          activo: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= ahora.getTime()) {
    await db.usuarioSesion.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (!session.usuario.activo) {
    return null;
  }

  const last = session.lastUsedAt?.getTime() ?? 0;
  if (ahora.getTime() - last >= LAST_USED_THROTTLE_MS) {
    await db.usuarioSesion
      .update({
        where: { id: session.id },
        data: { lastUsedAt: ahora },
      })
      .catch(() => {});
  }

  return {
    user: {
      id: session.usuario.id,
      nombre: session.usuario.nombre,
      usuario: session.usuario.usuario,
      rol: session.usuario.rol,
      activo: session.usuario.activo,
    },
    session: {
      id: session.id,
      usuarioId: session.usuarioId,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
    },
  };
}

/** Elimina solo la sesión del token dado (logout). */
export async function deleteSessionByToken(
  db: Db,
  token: string | undefined | null,
): Promise<void> {
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await db.usuarioSesion.deleteMany({ where: { tokenHash } });
}
