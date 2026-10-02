import type { PrismaClient, EstadoTicket } from "@prisma/client";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  TicketAlreadyAnuladoError,
  TicketNotFoundError,
} from "@/lib/tickets/errors";
import { validarMotivoAnulacion } from "@/lib/tickets/admin-ticket-query";
import { moneyToFixed2 } from "@/lib/tickets/ticket-liquidation";

type Db = Pick<PrismaClient, "ticket" | "auditoria" | "$transaction">;

export type TicketAnuladoResult = {
  id: string;
  numeroVisible: string;
  fechaJuego: string;
  totalApostado: string;
  estado: EstadoTicket;
  anuladoAt: string;
  /**
   * Usuario ADMIN que anuló (UsuarioSesion).
   * null solo en anulaciones históricas pre-UsuarioSesion.
   */
  anuladoPorId: string | null;
  motivoAnulacion: string;
};

/**
 * Anulación administrativa condicional:
 * UPDATE … WHERE id = X AND estado = EMITIDO
 *
 * Solo la primera anulación escribe anuladoAt / motivo / anuladoPorId.
 * Un segundo intento → TicketAlreadyAnuladoError (HTTP 409).
 *
 * Auditoría ANULAR_TICKET atómica con la anulación cuando hay actor.
 * No borra Ticket ni TicketLinea.
 */
export async function anularTicket(
  db: Db,
  args: {
    id: string;
    motivo: unknown;
    /** Usuario ADMIN actor (requerido para auditoría). */
    anuladoPorId?: string | null;
    ahora?: Date;
  },
): Promise<TicketAnuladoResult> {
  const id = args.id.trim();
  if (!id) throw new TicketNotFoundError();

  const motivo = validarMotivoAnulacion(args.motivo);
  const ahora = args.ahora ?? new Date();
  const anuladoPorId = args.anuladoPorId ?? null;

  return db.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: { id, estado: "EMITIDO" },
      data: {
        estado: "ANULADO",
        anuladoAt: ahora,
        motivoAnulacion: motivo,
        anuladoPorId,
      },
    });

    if (updated.count === 1) {
      const ticket = await tx.ticket.findUnique({ where: { id } });
      if (!ticket || ticket.estado !== "ANULADO" || !ticket.anuladoAt) {
        throw new Error("Inconsistencia tras anular ticket.");
      }

      if (anuladoPorId) {
        await recordAuditEvent(tx, {
          usuarioId: anuladoPorId,
          accion: "ANULAR_TICKET",
          entidad: "TICKET",
          entidadId: ticket.id,
          detalle: {
            numeroVisible: ticket.numeroVisible,
            motivo: ticket.motivoAnulacion ?? motivo,
            fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
            anuladoAt: ticket.anuladoAt.toISOString(),
          },
        });
      }

      return {
        id: ticket.id,
        numeroVisible: ticket.numeroVisible,
        fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
        totalApostado: moneyToFixed2(ticket.totalApostado),
        estado: ticket.estado,
        anuladoAt: ticket.anuladoAt.toISOString(),
        anuladoPorId: ticket.anuladoPorId,
        motivoAnulacion: ticket.motivoAnulacion ?? motivo,
      };
    }

    const existente = await tx.ticket.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });

    if (!existente) throw new TicketNotFoundError();
    if (existente.estado === "ANULADO") {
      throw new TicketAlreadyAnuladoError();
    }

    throw new TicketAlreadyAnuladoError(
      "No se pudo anular el ticket (estado no editable).",
    );
  });
}
