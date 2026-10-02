import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { COOKIE_LJ_SESSION } from "@/lib/auth/constants";
import {
  resolveSessionByToken,
  type AuthUser,
} from "@/lib/auth/session";

/**
 * Usuario autenticado (UsuarioSesion / lj_session).
 * null si no hay sesión válida. Nunca incluye passwordHash ni token.
 */
export async function getCurrentUser(
  ahora = new Date(),
): Promise<AuthUser | null> {
  const token = cookies().get(COOKIE_LJ_SESSION)?.value;
  const resolved = await resolveSessionByToken(prisma, token, ahora);
  return resolved?.user ?? null;
}

/**
 * Contexto de auth para layouts/UI.
 * Única fuente: UsuarioSesion vía lj_session.
 */
export async function getAuthContext(ahora = new Date()): Promise<{
  user: AuthUser | null;
}> {
  const user = await getCurrentUser(ahora);
  return { user };
}
