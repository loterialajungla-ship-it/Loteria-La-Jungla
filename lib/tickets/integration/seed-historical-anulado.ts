/**
 * Fixture de test: marca un ticket como ANULADO histórico.
 * NO es ruta de producto. C7.2 prohíbe anularTicket; esto solo simula
 * filas ANULADO preexistentes para reportes/liquidación.
 */
import type { PrismaClient } from "@prisma/client";

export async function seedHistoricalAnuladoForTests(
  db: Pick<PrismaClient, "ticket">,
  args: {
    ticketId: string;
    motivo: string;
    anuladoPorId: string | null;
    ahora?: Date;
  },
): Promise<void> {
  const ahora = args.ahora ?? new Date();
  await db.ticket.update({
    where: { id: args.ticketId },
    data: {
      estado: "ANULADO",
      anuladoAt: ahora,
      motivoAnulacion: args.motivo,
      anuladoPorId: args.anuladoPorId,
    },
  });
}
