import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import {
  parseResetPasswordBody,
  resetVendorPassword,
} from "@/lib/auth/password-management";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/usuarios/[id]/reset-password
 * Solo ADMIN → target VENDEDOR. No reactiva. Invalida sesiones del target.
 */
export async function POST(request: Request, { params }: Ctx) {
  let admin;
  try {
    admin = await requireAdmin();
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
    const parsed = parseResetPasswordBody(body);
    await resetVendorPassword(prisma, {
      actorUserId: admin.userId,
      targetUserId: params.id,
      newPassword: parsed.newPassword,
    });

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
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
