import type { Decimal } from "@prisma/client/runtime/library";
import type { EstadoTicket } from "@prisma/client";

/** Entrada cruda de una línea (API/UI). El importe se valida en el servicio. */
export type CreateTicketLineaInput = {
  hora: number;
  numeroAnimal: string;
  /** String preferido (ej. "2.00"); number solo se acepta si es finito. */
  importe: string | number;
};

export type CreateTicketInput = {
  /** Debe ser la fecha de hoy en America/Caracas (`YYYY-MM-DD`). */
  fechaJuego: string;
  /** Id del usuario autenticado (sesión). No confiar en el body del cliente. */
  vendedorId?: string | null;
  /** UUID de idempotencia (obligatorio en emisión nueva). */
  idempotencyKey: string;
  lineas: CreateTicketLineaInput[];
};

/** Línea ya validada y lista para persistir. */
export type TicketLineaPreparada = {
  hora: number;
  numeroAnimal: string;
  nombreAnimalSnapshot: string;
  importe: Decimal;
};

export type TicketCreadoLinea = {
  id: string;
  hora: number;
  numeroAnimal: string;
  nombreAnimalSnapshot: string;
  importe: string;
};

export type TicketCreado = {
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: string;
  vendedorId: string | null;
  totalApostado: string;
  /** Snapshot interno; la UI pública del ticket imagen no debe mostrarlo. */
  multiplicadorUsado: number;
  estado: EstadoTicket;
  createdAt: Date;
  lineas: TicketCreadoLinea[];
};

export type CreateTicketResult = {
  ticket: TicketCreado;
  idempotentReplay: boolean;
};
