import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { mapCreditoErrorToHttp } from "@/lib/creditos/api/map-credito-http-error";
import { getMiCuentaCreditos } from "@/lib/creditos/api/mi-cuenta";
import { CreditoDomainError } from "@/lib/creditos/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/creditos/mi-cuenta?page=&pageSize=&tipo=&ticketId=&desde=&hasta=
 * Solo el saldo/historial del usuario de sesión (VENDEDOR o ADMIN).
 * Ignora cualquier vendedorId del query/body.
 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    // Defensa: no usar vendedorId de query aunque venga.
    searchParams.delete("vendedorId");
    const result = await getMiCuentaCreditos(prisma, {
      sessionUserId: actor.userId,
      searchParams,
    });
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
