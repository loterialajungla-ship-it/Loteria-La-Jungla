import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { getAdminTicketById } from "@/lib/tickets/get-admin-ticket";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * GET /api/admin/tickets/[id]
 * Solo ADMIN.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const ticket = await getAdminTicketById(prisma, params.id);
    return NextResponse.json(
      { ok: true, ticket },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
