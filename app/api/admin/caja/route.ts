import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { getCajaConfig } from "@/lib/caja/config";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import {
  agregarTotalesVendedores,
  listResumenesVendedores,
} from "@/lib/caja/resumen";
import { serializeTotales } from "@/lib/caja/serializers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/caja
 * Resumen global + vendedores con actividad de Caja.
 * No activa Caja; solo informa el estado.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const [caja, rows] = await Promise.all([
      getCajaConfig(prisma),
      listResumenesVendedores(prisma),
    ]);
    const totales = agregarTotalesVendedores(rows);
    return NextResponse.json(
      {
        ok: true,
        caja: {
          activa: caja.activa,
          activadaEn: caja.activadaEn?.toISOString() ?? null,
          configPersisted: caja.configPersisted,
        },
        totales: serializeTotales(totales),
        vendedores: rows.map((r) => ({
          vendedorId: r.vendedorId,
          nombre: r.nombre,
          usuario: r.usuario,
          activo: r.activo,
          comisionPorcentaje: r.comisionPorcentaje,
          totales: serializeTotales(r.totales),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
