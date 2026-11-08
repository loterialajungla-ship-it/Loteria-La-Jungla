import { NextResponse } from "next/server";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { createTicket } from "@/lib/tickets/create-ticket";
import { listVendorTickets } from "@/lib/tickets/vendor-tickets";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";
import type { TicketCreado } from "@/lib/tickets/types";
import { rejectCrossOriginMutation } from "@/lib/http/csrf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Debe cubrir el presupuesto de la TX de emisión (`createTicket`:
 * maxWait 30s + timeout 60s). Mismo valor ya usado en
 * `/api/cron/resultados-automaticos`.
 *
 * Condición de deployment (pendiente de verificación operativa del plan):
 * el proyecto Vercel debe permitir `maxDuration ≥ 60` en esta función.
 * No se asume el plan aquí; si el techo del plan es menor, el deploy fallará
 * o Vercel rechazará el valor — comprobar en dashboard antes de publicar.
 */
export const maxDuration = 60;

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
        sort: searchParams.get("sort"),
        dir: searchParams.get("dir"),
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
 * Emisor = usuario autenticado. Body.vendedorId solo como atribución ADMIN
 * (revalidado en createTicket); VENDEDOR no puede atribuir a otro.
 */
export async function POST(request: Request) {
  const csrfBlock = rejectCrossOriginMutation(request);
  if (csrfBlock) return csrfBlock;

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
    const result = await createTicket(
      {
        ...input,
        vendedorId: actor.userId,
        atribuidoAVendedorId:
          actor.user.rol === "ADMIN" ? input.atribuidoAVendedorId : null,
      },
      new Date(),
      prisma,
      {
        actorRol: actor.user.rol,
        actorUserId: actor.userId,
        atribuidoAVendedorId:
          actor.user.rol === "ADMIN" ? input.atribuidoAVendedorId : null,
      },
    );
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
