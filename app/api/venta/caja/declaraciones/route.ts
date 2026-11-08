import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import {
  crearDeclaracionVendedor,
  listDeclaracionesVendedor,
} from "@/lib/caja/declaracion";
import { CajaForbiddenError, CajaValidationError } from "@/lib/caja/errors";
import { mapCajaErrorToHttp } from "@/lib/caja/map-caja-http-error";
import { serializeDeclaracion } from "@/lib/caja/serializers";
import { rejectCrossOriginMutation } from "@/lib/http/csrf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/venta/caja/declaraciones
 * Solo VENDEDOR: lista sus declaraciones.
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
        "Solo un vendedor puede listar sus declaraciones.",
        "CAJA_SOLO_VENDEDOR",
      );
    }
    const list = await listDeclaracionesVendedor(prisma, actor.userId);
    return NextResponse.json(
      { ok: true, declaraciones: list.map(serializeDeclaracion) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * POST /api/venta/caja/declaraciones
 * Body: { importe, idempotencyKey, nota? }
 * Solo VENDEDOR; declara para sí mismo.
 */
export async function POST(request: Request) {
  const csrfBlock = rejectCrossOriginMutation(request);
  if (csrfBlock) return csrfBlock;

  let actor;
  try {
    actor = await requireVendorOrAdmin();
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
    if (actor.user.rol !== "VENDEDOR") {
      throw new CajaForbiddenError(
        "Solo un vendedor puede declarar entregas.",
        "CAJA_SOLO_VENDEDOR",
      );
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CajaValidationError("El body debe ser un objeto JSON.");
    }
    const body = raw as Record<string, unknown>;
    if ("vendedorId" in body) {
      throw new CajaValidationError(
        "No se puede indicar vendedorId en la declaración.",
        "FORBIDDEN_FIELD",
      );
    }

    const result = await crearDeclaracionVendedor(prisma, {
      actorUserId: actor.userId,
      actorRol: "VENDEDOR",
      importe: body.importe as string | number,
      idempotencyKey: body.idempotencyKey,
      nota: typeof body.nota === "string" ? body.nota : null,
    });

    const status = result.idempotentReplay ? 200 : 201;
    return NextResponse.json(
      {
        ok: true,
        idempotentReplay: result.idempotentReplay,
        declaracion: serializeDeclaracion(result.declaracion),
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapCajaErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
