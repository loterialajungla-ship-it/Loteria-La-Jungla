import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { COOKIE_LJ_SESSION } from "@/lib/auth/constants";
import { clearLjSessionCookie } from "@/lib/auth/cookies";
import {
  deleteSessionByToken,
  resolveSessionByToken,
} from "@/lib/auth/session";
import { recordAuthAuditBestEffort } from "@/lib/audit/audit";
import { absoluteUrlFromRequest } from "@/lib/http/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/logout
 * Cierra UsuarioSesion y limpia cookie lj_session.
 * LOGOUT auditoría: best-effort; no guarda token.
 */
export async function POST(request: Request) {
  const token = cookies().get(COOKIE_LJ_SESSION)?.value;
  const resolved = await resolveSessionByToken(prisma, token);
  await deleteSessionByToken(prisma, token);

  if (resolved?.user.id) {
    await recordAuthAuditBestEffort(prisma, {
      usuarioId: resolved.user.id,
      accion: "LOGOUT",
      entidad: "AUTH",
      entidadId: resolved.user.id,
      detalle: { evento: "logout" },
    });
  }

  const response = NextResponse.redirect(
    absoluteUrlFromRequest(request, "/login"),
    { status: 303 },
  );

  clearLjSessionCookie(response);
  return response;
}
