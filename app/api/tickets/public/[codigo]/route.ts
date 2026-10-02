import { NextResponse } from "next/server";
import { getPublicTicketByCodigo } from "@/lib/tickets/get-public-ticket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: { codigo: string };
};

/**
 * GET /api/tickets/public/[codigo]
 * Público, solo lectura. Identificador: codigoPublico (no numeroVisible).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const codigo = decodeURIComponent(context.params.codigo ?? "").trim();
    if (!codigo) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Ticket no encontrado" } },
        { status: 404 },
      );
    }

    const ticket = await getPublicTicketByCodigo(codigo);
    if (!ticket) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Ticket no encontrado" } },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { ok: true, ticket },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}
