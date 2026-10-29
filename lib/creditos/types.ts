import type { Prisma, TipoCreditoMovimiento } from "@prisma/client";

export type CreditoCuentaView = {
  vendedorId: string;
  saldoDisponible: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
};

export type CreditoMovimientoView = {
  id: string;
  vendedorId: string;
  tipo: TipoCreditoMovimiento;
  importe: Prisma.Decimal;
  saldoAnterior: Prisma.Decimal;
  saldoPosterior: Prisma.Decimal;
  createdAt: Date;
  actorAdminId: string | null;
  ticketId: string | null;
  movimientoOrigenId: string | null;
  motivo: string | null;
  idempotencyKey: string | null;
};

export type CreditosConfigView = {
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo: Prisma.Decimal | null;
  updatedAt: Date;
  updatedByAdminId: string | null;
  /**
   * true si la fila singleton (id=1) existe en el almacén.
   * false = defaults virtuales (no equivale a “control desactivado” persistido).
   */
  configPersisted: boolean;
};

export type CorreccionEfecto = "AUMENTAR" | "DISMINUIR";
