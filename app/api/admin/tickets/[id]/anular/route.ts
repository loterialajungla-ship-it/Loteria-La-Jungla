import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { TicketAnulacionProhibidaError } from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/tickets/[id]/anular
 * C7.2: anulación deshabilitada. Siempre 403 (tras auth ADMIN).
 * No muta tickets, créditos ni Caja.
 */
export async function POST(_request: Request, _ctx: Ctx) {
  void _request;
  void _ctx;
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  const mapped = mapTicketErrorToHttp(new TicketAnulacionProhibidaError());
  return NextResponse.json(mapped.body, {
    status: mapped.status,
    headers: { "Cache-Control": "no-store" },
  });
}
