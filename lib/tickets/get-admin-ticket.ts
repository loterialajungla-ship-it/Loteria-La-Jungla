import type { PrismaClient, EstadoTicket } from "@prisma/client";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import {
  calcularPremioTotalPublico,
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
  moneyToFixed2,
  type EstadoTicketPublico,
  type LineaPublicaLiquidada,
  type ResultadoSorteoRef,
} from "@/lib/tickets/ticket-liquidation";

type Db = Pick<PrismaClient, "ticket" | "resultado">;

export type AdminTicketDetalle = {
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
  createdAt: string;
  totalApostado: string;
  /** Persistido */
  estado: EstadoTicket;
  /** Derivado */
  estadoDerivado: EstadoTicketPublico;
  multiplicadorUsado: number;
  premioTotal: string;
  liquidacionCompleta: boolean;
  anuladoAt: string | null;
  /**
   * TODO(auth-usuarios): enlazar con Usuario ADMIN autenticado.
   * Hoy permanece null (no existe tabla Usuario).
   */
  anuladoPorId: string | null;
  motivoAnulacion: string | null;
  lineas: LineaPublicaLiquidada[];
};

/**
 * Detalle admin con liquidación derivada vs Resultado actual.
 * Incluye multiplicadorUsado e info de auditoría de anulación.
 */
export async function getAdminTicketById(
  db: Db,
  id: string,
): Promise<AdminTicketDetalle> {
  const ticketId = id.trim();
  if (!ticketId) throw new TicketNotFoundError();

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      lineas: {
        orderBy: [{ hora: "asc" }, { numeroAnimal: "asc" }],
      },
    },
  });

  if (!ticket) throw new TicketNotFoundError();

  const horas = Array.from(new Set(ticket.lineas.map((l) => l.hora)));
  const resultados =
    horas.length === 0
      ? []
      : await db.resultado.findMany({
          where: {
            fecha: ticket.fechaJuego,
            hora: { in: horas },
          },
          include: {
            animal: { select: { numero: true, nombre: true } },
          },
        });

  const resultadoPorHora = new Map<number, ResultadoSorteoRef>();
  for (const r of resultados) {
    resultadoPorHora.set(r.hora, {
      numero: r.numero,
      nombre: r.animal.nombre,
    });
  }

  const ticketAnulado = ticket.estado === "ANULADO";
  const lineas = ticket.lineas.map((linea) =>
    liquidarLineaPublica({
      ticketAnulado,
      multiplicadorUsado: ticket.multiplicadorUsado,
      resultado: resultadoPorHora.get(linea.hora) ?? null,
      linea: {
        id: linea.id,
        hora: linea.hora,
        numeroAnimal: linea.numeroAnimal,
        nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
        importe: linea.importe,
      },
    }),
  );

  const estadoDerivado = derivarEstadoTicketPublico({
    ticketAnulado,
    estadosLineas: lineas.map((l) => l.estado),
  });

  const { premioTotal, liquidacionCompleta } = calcularPremioTotalPublico({
    ticketAnulado,
    lineas,
  });

  return {
    id: ticket.id,
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
    createdAt: ticket.createdAt.toISOString(),
    totalApostado: moneyToFixed2(ticket.totalApostado),
    estado: ticket.estado,
    estadoDerivado,
    multiplicadorUsado: ticket.multiplicadorUsado,
    premioTotal,
    liquidacionCompleta,
    anuladoAt: ticket.anuladoAt ? ticket.anuladoAt.toISOString() : null,
    anuladoPorId: ticket.anuladoPorId,
    motivoAnulacion: ticket.motivoAnulacion,
    lineas,
  };
}
