import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setLjSessionCookie } from "@/lib/auth/cookies";
import {
  loginWithCredentials,
  redirectPathForRole,
  resolveLoginClientIp,
} from "@/lib/auth/login";
import { rejectCrossOriginMutation } from "@/lib/http/csrf";
import { absoluteUrlFromRequest } from "@/lib/http/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/login
 * AUTH NUEVA: Usuario.usuario + password → lj_session.
 */
export async function POST(request: Request) {
  const csrfBlock = rejectCrossOriginMutation(request);
  if (csrfBlock) return csrfBlock;

  const formData = await request.formData();
  const usuario = String(formData.get("usuario") ?? "");
  const password = String(formData.get("password") ?? "");

  const resolvedIp = resolveLoginClientIp(request);
  if (resolvedIp.status === "rejected") {
    console.error("[auth] login rechazado: sin IP de borde confiable");
    return NextResponse.redirect(
      absoluteUrlFromRequest(request, "/login?error=1"),
      { status: 303 },
    );
  }

  const result = await loginWithCredentials(prisma, {
    usuario,
    password,
    clientIp: resolvedIp.ip,
  });

  if (!result) {
    return NextResponse.redirect(
      absoluteUrlFromRequest(request, "/login?error=1"),
      { status: 303 },
    );
  }

  const dest = redirectPathForRole(result.user.rol);
  const response = NextResponse.redirect(
    absoluteUrlFromRequest(request, dest),
    {
      status: 303,
    },
  );
  setLjSessionCookie(response, result.token);
  return response;
}
