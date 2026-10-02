import { prisma } from "@/lib/prisma";
import {
  HORAS_SORTEO,
  fechaAYYYYMMDD,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import {
  InvalidDrawHourError,
  InvalidGameDateError,
} from "@/lib/tickets/errors";
import {
  aggregateExposure,
  type ExposicionSorteo,
} from "@/lib/tickets/aggregate-exposure";

export type { ExposicionSorteo };

/**
 * Exposición / riesgo de un sorteo (fecha + hora).
 * Solo tickets EMITIDO. Usa multiplicadorUsado de cada ticket.
 */
export async function getExposureForDraw(args: {
  fechaJuego: string;
  hora: number;
}): Promise<ExposicionSorteo> {
  const fecha = parseFechaYYYYMMDD(args.fechaJuego);
  if (!fecha) {
    throw new InvalidGameDateError("Fecha de juego inválida.");
  }

  if (
    !Number.isInteger(args.hora) ||
    !(HORAS_SORTEO as readonly number[]).includes(args.hora)
  ) {
    throw new InvalidDrawHourError(args.hora);
  }

  const [animales, lineas] = await Promise.all([
    prisma.animal.findMany({
      select: { numero: true, nombre: true },
    }),
    prisma.ticketLinea.findMany({
      where: {
        fechaJuego: fecha,
        hora: args.hora,
        ticket: { estado: "EMITIDO" },
      },
      select: {
        ticketId: true,
        numeroAnimal: true,
        importe: true,
        ticket: {
          select: { multiplicadorUsado: true },
        },
      },
    }),
  ]);

  return aggregateExposure({
    fechaJuego: fechaAYYYYMMDD(fecha),
    hora: args.hora,
    catalogo: animales,
    lineas: lineas.map((l) => ({
      ticketId: l.ticketId,
      numeroAnimal: l.numeroAnimal,
      importe: l.importe,
      multiplicadorUsado: l.ticket.multiplicadorUsado,
    })),
  });
}
