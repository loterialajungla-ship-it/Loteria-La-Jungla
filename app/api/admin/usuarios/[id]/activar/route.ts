import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { activarUsuario } from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/usuarios/[id]/activar
 * Solo ADMIN. Reactiva VENDEDOR (activo=true).
 */
export async function POST(_request: Request, { params }: Ctx) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const user = await activarUsuario(prisma, {
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
