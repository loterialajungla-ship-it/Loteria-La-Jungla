import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { desactivarUsuario } from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/usuarios/[id]/desactivar
 * Solo ADMIN. Soft-disable: activo=false. Sesiones quedan inválidas vía check activo.
 */
export async function POST(_request: Request, { params }: Ctx) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const user = await desactivarUsuario(prisma, {
      id: params.id,
      actorUserId: admin.userId,
    });
    return NextResponse.json(
      { ok: true, user },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}
