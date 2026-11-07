import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import {
  getComisionVigente,
  listComisionHistorial,
  setComisionVendedor,
} from "@/lib/caja/comision";
import { CajaNotFoundError, CajaValidationError } from "@/lib/caja/errors";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import { moneyFixed2 } from "@/lib/caja/money";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { vendedorId: string } };

async function assertVendedor(vendedorId: string) {
  const user = await prisma.usuario.findUnique({
    where: { id: vendedorId },
    select: { id: true, rol: true },
  });
  if (!user || user.rol !== "VENDEDOR") {
    throw new CajaNotFoundError(
      "Vendedor no encontrado.",
      "CAJA_VENDEDOR_NO_ENCONTRADO",
    );
  }
}

/**
 * GET /api/admin/caja/vendedores/[vendedorId]/comision
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const vendedorId = params.vendedorId?.trim();
    if (!vendedorId) throw new CajaValidationError("vendedorId requerido.");
    await assertVendedor(vendedorId);
    const [comision, historial] = await Promise.all([
      getComisionVigente(prisma, vendedorId),
      listComisionHistorial(prisma, vendedorId),
    ]);
    return NextResponse.json(
      {
        ok: true,
        vendedorId,
        comision: comision
          ? {
              porcentaje: moneyFixed2(comision.porcentaje),
              updatedAt: comision.updatedAt.toISOString(),
              updatedByAdminId: comision.updatedByAdminId,
            }
          : null,
        historial: historial.map((h) => ({
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
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * PATCH /api/admin/caja/vendedores/[vendedorId]/comision
 * Body: { porcentaje, motivo? }
 * Solo afecta tickets futuros (snapshot en obligación).
 */
export async function PATCH(request: Request, { params }: Ctx) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  let raw: unknown;
  try {
    raw = await request.json();
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
    const vendedorId = params.vendedorId?.trim();
    if (!vendedorId) throw new CajaValidationError("vendedorId requerido.");
    await assertVendedor(vendedorId);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CajaValidationError("El body debe ser un objeto JSON.");
    }
    const body = raw as Record<string, unknown>;
    const result = await setComisionVendedor(prisma, {
      vendedorId,
      porcentaje: body.porcentaje as string | number,
      actorAdminId: admin.userId,
      motivo: typeof body.motivo === "string" ? body.motivo : null,
    });

    return NextResponse.json(
      {
        ok: true,
        changed: result.changed,
        comision: {
          porcentaje: moneyFixed2(result.comision.porcentaje),
          updatedAt: result.comision.updatedAt.toISOString(),
          updatedByAdminId: result.comision.updatedByAdminId,
        },
        historial: result.historial
          ? {
              id: result.historial.id,
              porcentajeAnterior:
                result.historial.porcentajeAnterior == null
                  ? null
                  : moneyFixed2(result.historial.porcentajeAnterior),
              porcentajeNuevo: moneyFixed2(result.historial.porcentajeNuevo),
              changedAt: result.historial.changedAt.toISOString(),
              changedByAdminId: result.historial.changedByAdminId,
              motivo: result.historial.motivo,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
