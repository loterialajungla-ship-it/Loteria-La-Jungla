import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { getExposureForDraw } from "@/lib/tickets/get-exposure";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { TicketValidationError } from "@/lib/tickets/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/exposicion?fecha=YYYY-MM-DD&hora=12
 * Solo ADMIN.
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
    const horaRaw = searchParams.get("hora");

    if (!fecha || !horaRaw) {
      throw new TicketValidationError(
        "Parámetros fecha y hora son requeridos.",
        "INVALID_QUERY",
      );
    }

    const hora = Number(horaRaw);
    if (!Number.isInteger(hora)) {
      throw new TicketValidationError(
        "hora debe ser un entero.",
        "INVALID_QUERY",
      );
    }

    const exposicion = await getExposureForDraw({
      fechaJuego: fecha,
      hora,
    });

    return NextResponse.json(
      { ok: true, exposicion },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
