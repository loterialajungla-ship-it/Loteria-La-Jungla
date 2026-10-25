/**
 * Reconciliación segura: existe Resultado publicado para (fecha, hora) y
 * puede quedar una programación PENDIENTE (p. ej. carrera o P2002 unknown).
 *
 * Usa solo la clave exacta [fecha, hora] + estado/número — no depende del
 * meta.target del P2002.
 */
import type { EstadoResultadoProgramado, PrismaClient } from "@prisma/client";

export type ReconcilePendingDb = Pick<PrismaClient, "resultadoProgramado">;

export type ReconcilePendingResult = {
  /** Enlazó PENDIENTE del mismo número → PUBLICADO. */
  linked: boolean;
  /** Marcó otra PENDIENTE (número distinto o residual) → SUPERSEDED. */
  superseded: boolean;
};

/**
 * Si hay PENDIENTE con el mismo número que el Resultado → PUBLICADO + resultadoId.
 * Si queda PENDIENTE (otro número) → SUPERSEDED.
 * No toca PUBLICADO / CANCELADO / SUPERSEDED.
 */
export async function reconcilePendingScheduleForPublishedSlot(
  db: ReconcilePendingDb,
  args: {
    fecha: Date;
    hora: number;
    resultadoId: string;
    numero: string;
  },
): Promise<ReconcilePendingResult> {
  const linked = await db.resultadoProgramado.updateMany({
    where: {
      fecha: args.fecha,
      hora: args.hora,
      estado: "PENDIENTE" satisfies EstadoResultadoProgramado,
      numero: args.numero,
    },
    data: {
      estado: "PUBLICADO",
      resultadoId: args.resultadoId,
    },
  });

  if (linked.count >= 1) {
    return { linked: true, superseded: false };
  }

  const superseded = await db.resultadoProgramado.updateMany({
    where: {
      fecha: args.fecha,
      hora: args.hora,
      estado: "PENDIENTE",
    },
    data: { estado: "SUPERSEDED" },
  });

  return { linked: false, superseded: superseded.count >= 1 };
}
