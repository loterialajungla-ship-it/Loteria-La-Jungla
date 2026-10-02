import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  HORAS_SORTEO,
  fechaAYYYYMMDD,
  formatearHoraSorteo,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import {
  aggregateExposure,
} from "@/lib/tickets/aggregate-exposure";
import { InvalidGameDateError } from "@/lib/tickets/errors";
import {
  derivarEstadoTicketPublico,
  liquidarLineaPublica,
  moneyToFixed2,
  type ResultadoSorteoRef,
} from "@/lib/tickets/ticket-liquidation";
import {
  aggregateSalesByAnimal,
  aggregateSalesByHour,
  aggregateSalesByVendor,
} from "@/lib/reports/aggregate-sales";
import type { DailyReport } from "@/lib/reports/report-types";

type Db = Pick<
  PrismaClient,
  "ticket" | "ticketLinea" | "animal" | "resultado"
>;

/**
 * Reporte operativo diario por fecha de juego.
 * Solo EMITIDO en ventas/exposición; anulados solo en contadores.
 * Exposición: misma matemática que getExposureForDraw (aggregateExposure +
 * multiplicadorUsado), con una sola carga de líneas/catálogo (sin N+1).
 */
export async function getDailyReport(
  db: Db,
  fechaJuego: string,
): Promise<DailyReport> {
  const fecha = parseFechaYYYYMMDD(fechaJuego);
  if (!fecha) {
    throw new InvalidGameDateError("Fecha de juego inválida.");
  }
  const fechaStr = fechaAYYYYMMDD(fecha);

  const [ticketRows, lineas, catalogo, resultados] = await Promise.all([
    db.ticket.findMany({
      where: { fechaJuego: fecha },
      select: {
        id: true,
        estado: true,
        totalApostado: true,
        multiplicadorUsado: true,
        vendedorId: true,
        vendedor: {
          select: { id: true, nombre: true, usuario: true },
        },
        lineas: {
          select: {
            id: true,
            hora: true,
            numeroAnimal: true,
            nombreAnimalSnapshot: true,
            importe: true,
          },
        },
      },
    }),
    db.ticketLinea.findMany({
      where: {
        fechaJuego: fecha,
        ticket: { estado: "EMITIDO" },
      },
      select: {
        ticketId: true,
        hora: true,
        numeroAnimal: true,
        importe: true,
        ticket: { select: { multiplicadorUsado: true } },
      },
    }),
    db.animal.findMany({
      select: { numero: true, nombre: true },
    }),
    db.resultado.findMany({
      where: { fecha },
      include: { animal: { select: { numero: true, nombre: true } } },
    }),
  ]);

  let emitidos = 0;
  let anulados = 0;
  let totalJugado = new Prisma.Decimal(0);
  const emitidosParaVendor: {
    vendedorId: string | null;
    nombre: string | null;
    usuario: string | null;
    totalApostado: Prisma.Decimal;
  }[] = [];

  const resultadoMap = new Map<string, ResultadoSorteoRef>();
  for (const r of resultados) {
    resultadoMap.set(`${fechaStr}|${r.hora}`, {
      numero: r.numero,
      nombre: r.animal.nombre,
    });
  }

  let ganadores = 0;
  let noGanadores = 0;
  let pendientes = 0;

  for (const t of ticketRows) {
    if (t.estado === "ANULADO") {
      anulados += 1;
      continue;
    }

    emitidos += 1;
    totalJugado = totalJugado.plus(t.totalApostado);
    emitidosParaVendor.push({
      vendedorId: t.vendedorId,
      nombre: t.vendedor?.nombre ?? null,
      usuario: t.vendedor?.usuario ?? null,
      totalApostado: t.totalApostado,
    });

    const ticketAnulado = false;
    const estadosLineas = t.lineas.map((linea) =>
      liquidarLineaPublica({
        ticketAnulado,
        multiplicadorUsado: t.multiplicadorUsado,
        resultado: resultadoMap.get(`${fechaStr}|${linea.hora}`) ?? null,
        linea: {
          id: linea.id,
          hora: linea.hora,
          numeroAnimal: linea.numeroAnimal,
          nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
          importe: linea.importe,
        },
      }).estado,
    );

    const derivado = derivarEstadoTicketPublico({
      ticketAnulado,
      estadosLineas,
    });
    if (derivado === "GANADOR") ganadores += 1;
    else if (derivado === "NO_GANADOR") noGanadores += 1;
    else if (derivado === "PENDIENTE") pendientes += 1;
  }

  const porVendedor = aggregateSalesByVendor(emitidosParaVendor);
  const porHora = aggregateSalesByHour(lineas);
  const porAnimal = aggregateSalesByAnimal(lineas, catalogo);

  const exposicion = HORAS_SORTEO.map((hora) => {
    const lineasHora = lineas
      .filter((l) => l.hora === hora)
      .map((l) => ({
        ticketId: l.ticketId,
        numeroAnimal: l.numeroAnimal,
        importe: l.importe,
        multiplicadorUsado: l.ticket.multiplicadorUsado,
      }));

    const exp = aggregateExposure({
      fechaJuego: fechaStr,
      hora,
      catalogo,
      lineas: lineasHora,
    });

    return {
      hora,
      horaLabel: formatearHoraSorteo(hora),
      totalApostado: exp.totalApostado,
      exposicionTotalTeorica: exp.totalExposicion,
      mayorExposicion: exp.mayorExposicion,
      ticketsAfectados: exp.ticketsAfectados,
    };
  });

  return {
    fechaJuego: fechaStr,
    tickets: {
      emitidos,
      anulados,
      ganadores,
      noGanadores,
      pendientes,
    },
    ventas: {
      totalJugado: moneyToFixed2(totalJugado),
    },
    porVendedor,
    porHora,
    porAnimal,
    exposicion,
  };
}
