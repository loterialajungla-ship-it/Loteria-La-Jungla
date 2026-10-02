import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { getOpenDrawHours } from "@/lib/tickets/get-open-draw-hours";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/venta/horas-disponibles
 * ADMIN | VENDEDOR (UsuarioSesion).
 */
export async function GET() {
  try {
    await requireVendorOrAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const data = await getOpenDrawHours(prisma);
    return NextResponse.json(
      { ok: true, ...data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}
