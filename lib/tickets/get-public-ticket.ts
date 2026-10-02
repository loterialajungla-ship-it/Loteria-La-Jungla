import { prisma } from "@/lib/prisma";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  calcularPremioTotalPublico,
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
  moneyToFixed2,
} from "@/lib/tickets/ticket-liquidation";
import type {
  EstadoTicketPublico,
  LineaPublicaLiquidada,
  ResultadoSorteoRef,
} from "@/lib/tickets/ticket-liquidation";

export type TicketPublico = {
  id: string;
  numeroVisible: string;
  fechaJuego: string;
  /** Estado derivado (no el enum crudo de DB, salvo ANULADO). */
  estado: EstadoTicketPublico;
  totalApostado: string;
  /**
   * Suma de premios de líneas GANADORAS ya resueltas.
   * Si `liquidacionCompleta` es false, es premio acumulado (hay sorteos pendientes).
   */
  premioTotal: string;
  liquidacionCompleta: boolean;
  lineas: LineaPublicaLiquidada[];
  createdAt: string;
};

/**
 * Lectura pública por codigoPublico + liquidación derivada vs Resultado.
 * Solo lectura. No usa ConfigNegocio; usa Ticket.multiplicadorUsado.
 */
export async function getPublicTicketByCodigo(
  codigoPublico: string,
): Promise<TicketPublico | null> {
  const codigo = codigoPublico.trim();
  if (!codigo) return null;

  const ticket = await prisma.ticket.findUnique({
    where: { codigoPublico: codigo },
    include: {
      lineas: {
        orderBy: [{ hora: "asc" }, { numeroAnimal: "asc" }],
      },
    },
  });

  if (!ticket) return null;

  const horas = Array.from(new Set(ticket.lineas.map((l) => l.hora)));

  const resultados =
    horas.length === 0
      ? []
      : await prisma.resultado.findMany({
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

  const estado = derivarEstadoTicketPublico({
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
    fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
    estado,
    totalApostado: moneyToFixed2(ticket.totalApostado),
    premioTotal,
    liquidacionCompleta,
    lineas,
    createdAt: ticket.createdAt.toISOString(),
  };
}
