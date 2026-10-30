import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { adminAsignarCreditos } from "@/lib/creditos/api/admin-mutaciones";
import { mapCreditoErrorToHttp } from "@/lib/creditos/api/map-credito-http-error";
import { CreditoDomainError } from "@/lib/creditos/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { vendedorId: string } };

/**
 * POST /api/admin/creditos/[vendedorId]/asignar
 * Body: { importe, idempotencyKey, motivo? }. Actor = sesión ADMIN.
 */
export async function POST(request: Request, { params }: Ctx) {
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
    const result = await adminAsignarCreditos(prisma, {
      vendedorId: params.vendedorId,
      actorAdminId: admin.userId,
      body: raw,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CreditoDomainError) {
      const mapped = mapCreditoErrorToHttp(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}
