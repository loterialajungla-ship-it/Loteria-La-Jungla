import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { clearLjSessionCookie } from "@/lib/auth/cookies";
import { jsonAuthError } from "@/lib/auth/http";
import {
  changeOwnPassword,
  parseChangePasswordBody,
} from "@/lib/auth/password-management";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/change-password
 * ADMIN | VENDEDOR autenticado. Invalida todas sus sesiones.
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    return jsonAuthError(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_JSON", message: "JSON inválido." },
      },
      { status: 400 },
    );
  }

  try {
    const parsed = parseChangePasswordBody(body);
    await changeOwnPassword(prisma, {
      userId: user.id,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
    });

    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    clearLjSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 },
    );
  }
}
