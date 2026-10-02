import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { listAuditoria } from "@/lib/audit/list-auditoria";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/auditoria?fecha=&accion=&usuarioId=&entidad=&page=&pageSize=
 * Solo ADMIN. Sin secretos.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await listAuditoria(prisma, {
      fecha: searchParams.get("fecha"),
      accion: searchParams.get("accion"),
      usuarioId: searchParams.get("usuarioId"),
      entidad: searchParams.get("entidad"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return NextResponse.json(
      { ok: true, ...result },
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
