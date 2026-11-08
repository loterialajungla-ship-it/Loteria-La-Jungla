import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { crearConfirmacionAdmin } from "@/lib/caja/confirmacion";
import { CajaValidationError } from "@/lib/caja/errors";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import {
  serializeAplicacion,
  serializeConfirmacion,
  serializeDeclaracion,
} from "@/lib/caja/serializers";
import { rejectCrossOriginMutation } from "@/lib/http/csrf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/caja/declaraciones/[id]/confirmar
 * Body: { importe, idempotencyKey }
 */
export async function POST(request: Request, { params }: Ctx) {
  const csrfBlock = rejectCrossOriginMutation(request);
  if (csrfBlock) return csrfBlock;

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
    const declaracionId = params.id?.trim();
    if (!declaracionId) {
      throw new CajaValidationError("declaracionId requerido.");
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CajaValidationError("El body debe ser un objeto JSON.");
    }
    const body = raw as Record<string, unknown>;

    const result = await crearConfirmacionAdmin(prisma, {
      actorAdminId: admin.userId,
      actorRol: "ADMIN",
      declaracionId,
      importe: body.importe as string | number,
      idempotencyKey: body.idempotencyKey,
    });

    const oblIds = [
      ...new Set(result.aplicaciones.map((a) => a.obligacionId)),
    ];
    const oblRows =
      oblIds.length === 0
        ? []
        : await prisma.cajaObligacion.findMany({
            where: { id: { in: oblIds } },
            select: {
              id: true,
              ticketId: true,
              ticket: { select: { createdAt: true } },
            },
          });
    const oblMap = new Map(oblRows.map((o) => [o.id, o]));
    const aplicaciones = result.aplicaciones.map((a) => {
      const obl = oblMap.get(a.obligacionId);
      return serializeAplicacion({
        ...a,
        ticketId: obl?.ticketId,
        ticketCreatedAt: obl?.ticket.createdAt,
      });
    });

    const status = result.idempotentReplay ? 200 : 201;
    return NextResponse.json(
      {
        ok: true,
        idempotentReplay: result.idempotentReplay,
        confirmacion: serializeConfirmacion(result.confirmacion),
        declaracion: serializeDeclaracion(result.declaracion),
        aplicaciones,
        pendientesAplicar: "0.00",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
