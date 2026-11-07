import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import {
  getComisionVigente,
  listComisionHistorial,
} from "@/lib/caja/comision";
import { CajaNotFoundError, CajaValidationError } from "@/lib/caja/errors";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import { moneyFixed2 } from "@/lib/caja/money";
import { getResumenVendedor } from "@/lib/caja/resumen";
import { serializeResumenVendedor } from "@/lib/caja/serializers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { vendedorId: string } };

/**
 * GET /api/admin/caja/vendedores/[vendedorId]
 * Resumen + comisión vigente + historial (solo lectura).
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const vendedorId = params.vendedorId?.trim();
    if (!vendedorId) {
      throw new CajaValidationError("vendedorId requerido.");
    }
    const user = await prisma.usuario.findUnique({
      where: { id: vendedorId },
      select: {
        id: true,
        rol: true,
        nombre: true,
        usuario: true,
        activo: true,
      },
    });
    if (!user || user.rol !== "VENDEDOR") {
      throw new CajaNotFoundError(
        "Vendedor no encontrado.",
        "CAJA_VENDEDOR_NO_ENCONTRADO",
      );
    }
    const [resumen, comision, historial] = await Promise.all([
      getResumenVendedor(prisma, vendedorId),
      getComisionVigente(prisma, vendedorId),
      listComisionHistorial(prisma, vendedorId),
    ]);
    return NextResponse.json(
      {
        ok: true,
        nombre: user.nombre,
        usuario: user.usuario,
        activo: user.activo,
        comision: comision
          ? {
              porcentaje: moneyFixed2(comision.porcentaje),
              updatedAt: comision.updatedAt.toISOString(),
              updatedByAdminId: comision.updatedByAdminId,
            }
          : null,
        historialComision: historial.map((h) => ({
          id: h.id,
          porcentajeAnterior:
            h.porcentajeAnterior == null
              ? null
              : moneyFixed2(h.porcentajeAnterior),
          porcentajeNuevo: moneyFixed2(h.porcentajeNuevo),
          changedAt: h.changedAt.toISOString(),
          changedByAdminId: h.changedByAdminId,
          motivo: h.motivo,
        })),
        ...serializeResumenVendedor(resumen),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
