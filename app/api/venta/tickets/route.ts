import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { createTicket } from "@/lib/tickets/create-ticket";
import { listVendorTickets } from "@/lib/tickets/vendor-tickets";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";
import type { TicketCreado } from "@/lib/tickets/types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/venta/tickets
 * ADMIN | VENDEDOR. Vendedor solo ve los suyos.
 * Ignora ?vendedorId= del cliente.
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
    const result = await listVendorTickets(
      prisma,
      { userId: actor.userId, rol: actor.user.rol },
      {
        fecha: searchParams.get("fecha"),
        estado: searchParams.get("estado"),
        numero: searchParams.get("numero") ?? searchParams.get("numeroVisible"),
        page: searchParams.get("page"),
        pageSize: searchParams.get("pageSize"),
      },
    );

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * POST /api/venta/tickets
 * AUTH NUEVA: ADMIN | VENDEDOR.
 * vendedorId = usuario autenticado (ignora body).
 */
export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
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
    const input = parseCreateTicketBody(raw);
    const result = await createTicket({
      ...input,
      vendedorId: actor.userId,
    });
    const status = result.idempotentReplay ? 200 : 201;
    return NextResponse.json(
      {
        ok: true,
        idempotentReplay: result.idempotentReplay,
        ticket: toVentaTicketResponse(result.ticket),
      },
      { status },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    const mapped = mapTicketErrorToHttp(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

function toVentaTicketResponse(ticket: TicketCreado) {
  return {
    id: ticket.id,
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: ticket.fechaJuego,
    totalApostado: ticket.totalApostado,
    estado: ticket.estado,
    lineas: ticket.lineas.map((linea) => ({
      id: linea.id,
      hora: linea.hora,
      numeroAnimal: linea.numeroAnimal,
      nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
      importe: linea.importe,
    })),
  };
}
