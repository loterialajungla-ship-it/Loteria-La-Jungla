import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/tickets?fecha=&estado=&numero=&page=&pageSize=
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
    const result = await listAdminTickets(prisma, {
      fecha: searchParams.get("fecha"),
      estado: searchParams.get("estado"),
      numero: searchParams.get("numero") ?? searchParams.get("numeroVisible"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
