import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { getVendorTicketById } from "@/lib/tickets/vendor-tickets";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * GET /api/venta/tickets/[id]
 * VENDEDOR: solo propios (ajeno/inexistente → 404).
 * ADMIN: cualquiera.
 */
export async function GET(_request: Request, { params }: Ctx) {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const ticket = await getVendorTicketById(
      prisma,
      { userId: actor.userId, rol: actor.user.rol },
      params.id,
    );
    return NextResponse.json(
      { ok: true, ticket },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
