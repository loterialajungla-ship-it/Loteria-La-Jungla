import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { listCreditosResumenAdmin } from "@/lib/creditos/api/admin-resumen";
import { mapCreditoErrorToHttp } from "@/lib/creditos/api/map-credito-http-error";
import { CreditoDomainError } from "@/lib/creditos/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/creditos?activo=&saldoBajo=&page=&pageSize=
 * Resumen de créditos por vendedor. Solo ADMIN.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await listCreditosResumenAdmin(prisma, searchParams);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
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
