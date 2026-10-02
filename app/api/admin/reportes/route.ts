import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { getDailyReport } from "@/lib/reports/get-daily-report";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { TicketValidationError } from "@/lib/tickets/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/reportes?fecha=YYYY-MM-DD
 * Solo ADMIN. Reporte operativo por fecha de juego.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    const fecha = searchParams.get("fecha");
    if (!fecha || !fecha.trim()) {
      throw new TicketValidationError(
        "Parámetro fecha es requerido (YYYY-MM-DD).",
        "INVALID_QUERY",
      );
    }

    const reporte = await getDailyReport(prisma, fecha.trim());

    return NextResponse.json(
      { ok: true, reporte },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
