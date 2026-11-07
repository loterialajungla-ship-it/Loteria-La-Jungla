/**
 * Anulación de tickets — PROHIBIDA (política C7.2).
 *
 * Decisión de negocio: no existen anulaciones ni devoluciones.
 * Esta función se conserva solo como compatibilidad de import; siempre rechaza
 * antes de cualquier escritura (ticket, créditos, Caja, auditoría).
 */
import type { Prisma, PrismaClient, EstadoTicket } from "@prisma/client";
import type { CreditosStore } from "@/lib/creditos/store";
import { TicketAnulacionProhibidaError } from "@/lib/tickets/errors";

type Db = Pick<PrismaClient, "ticket" | "auditoria" | "$transaction">;

export type AnularTicketOptions = {
  /** Conservado por compatibilidad; nunca se usa. */
  bindCreditsStore?: (tx: Prisma.TransactionClient) => CreditosStore;
};

export type TicketAnuladoResult = {
  id: string;
  numeroVisible: string;
  fechaJuego: string;
  totalApostado: string;
  estado: EstadoTicket;
  anuladoAt: string;
  anuladoPorId: string | null;
  motivoAnulacion: string;
};

/**
 * @throws {TicketAnulacionProhibidaError} siempre — no muta estado.
 */
export async function anularTicket(
  db: Db,
  args: {
    id: string;
    motivo: unknown;
    anuladoPorId?: string | null;
    ahora?: Date;
  },
  options: AnularTicketOptions = {},
): Promise<TicketAnuladoResult> {
  void db;
  void args;
  void options;
  throw new TicketAnulacionProhibidaError();
}
