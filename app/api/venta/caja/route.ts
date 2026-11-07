import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { CajaForbiddenError } from "@/lib/caja/errors";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import { getResumenVendedor } from "@/lib/caja/resumen";
import { serializeResumenVendedor } from "@/lib/caja/serializers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/venta/caja
 * Solo VENDEDOR: resumen propio de Caja.
 */
export async function GET() {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    if (actor.user.rol !== "VENDEDOR") {
      throw new CajaForbiddenError(
        "Solo un vendedor puede consultar su Caja de venta.",
        "CAJA_SOLO_VENDEDOR",
      );
    }
    const resumen = await getResumenVendedor(prisma, actor.userId);
    return NextResponse.json(
      { ok: true, ...serializeResumenVendedor(resumen) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
