import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { prisma } from "@/lib/prisma";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { parseAnularTicketBody } from "@/lib/tickets/admin-ticket-query";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { getAdminTicketById } from "@/lib/tickets/get-admin-ticket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { id: string } };

/**
 * POST /api/admin/tickets/[id]/anular
 * Solo ADMIN. anuladoPorId = usuario.id de la sesión ADMIN.
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
    const { motivo } = parseAnularTicketBody(raw);
    await anularTicket(prisma, {
      id: params.id,
      motivo,
      anuladoPorId: admin.userId,
    });

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
