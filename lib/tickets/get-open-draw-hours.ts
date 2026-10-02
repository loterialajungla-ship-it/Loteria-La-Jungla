import type { PrismaClient } from "@prisma/client";
import { fechaHoyParaPrisma, hoyYYYYMMDD } from "@/lib/fecha";
import {
  horaActualVenezuela,
  listarDisponibilidadHoras,
  type HoraDisponibilidad,
} from "@/lib/tickets/draw-hours";

type Db = Pick<PrismaClient, "resultado">;

export type OpenDrawHoursResult = {
  fechaJuego: string;
  horas: HoraDisponibilidad[];
};

/**
 * Horas abiertas/cerradas para venta del día actual (Caracas).
 * Una sola query de resultados del día (sin N+1).
 */
export async function getOpenDrawHours(
  db: Db,
  ahora = new Date(),
): Promise<OpenDrawHoursResult> {
  const fecha = fechaHoyParaPrisma(ahora);
  const resultados = await db.resultado.findMany({
    where: { fecha },
    select: { hora: true },
  });

  const horasConResultado = new Set(resultados.map((r) => r.hora));
  const horaActualVe = horaActualVenezuela(ahora);

  return {
    fechaJuego: hoyYYYYMMDD(ahora),
    horas: listarDisponibilidadHoras({
      horaActualVe,
      horasConResultado,
    }),
  };
}
