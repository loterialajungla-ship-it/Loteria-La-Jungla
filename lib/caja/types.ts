import type { Prisma } from "@prisma/client";

export type CajaConfigView = {
  activa: boolean;
  activadaEn: Date | null;
  activadaPorAdminId: string | null;
  updatedAt: Date;
  /** true si existe la fila singleton id=1. */
  configPersisted: boolean;
};

export type VendedorComisionView = {
  vendedorId: string;
  porcentaje: Prisma.Decimal;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

export type VendedorComisionHistorialView = {
  id: string;
  vendedorId: string;
  porcentajeAnterior: Prisma.Decimal | null;
  porcentajeNuevo: Prisma.Decimal;
  changedAt: Date;
  changedByAdminId: string | null;
  motivo: string | null;
};

export type ActivarCajaResult = {
  config: CajaConfigView;
  /** true si ya estaba activa (no se reinició activadaEn). */
  alreadyActive: boolean;
  /** Vendedores a los que se asignó 20 % en esta activación. */
  comisionesInicializadas: number;
};

/** Snapshot inmutable de una obligación de Caja (1:1 con ticket elegible). */
export type CajaObligacionView = {
  id: string;
  ticketId: string;
  vendedorId: string;
  bruto: Prisma.Decimal;
  comisionPorcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
  createdAt: Date;
};

export type CajaDeclaracionEstado = "PENDIENTE" | "PARCIAL" | "CONFIRMADA";

export type CajaTotalesView = {
  /** Suma de CajaObligacion.bruto. */
  totalBruto: Prisma.Decimal;
  /** Suma de CajaObligacion.comisionImporte. */
  totalComision: Prisma.Decimal;
  totalObligado: Prisma.Decimal;
  totalDeclarado: Prisma.Decimal;
  totalConfirmado: Prisma.Decimal;
  /** Suma de CajaAplicacion.importeAplicado del vendedor. */
  totalAplicado: Prisma.Decimal;
  /** totalConfirmado - totalAplicado (C5). */
  pendienteAplicar: Prisma.Decimal;
  /** totalObligado - totalAplicado (saldo de obligaciones sin cubrir). */
  totalPendienteObligaciones: Prisma.Decimal;
  deudaPendienteEntregar: Prisma.Decimal;
  pendienteConfirmar: Prisma.Decimal;
  pendienteDeclarar: Prisma.Decimal;
  maxNuevaDeclaracion: Prisma.Decimal;
};

export type CajaDeclaracionView = {
  id: string;
  vendedorId: string;
  importeDeclarado: Prisma.Decimal;
  declaradoAt: Date;
  nota: string | null;
  totalConfirmado: Prisma.Decimal;
  pendienteConfirmar: Prisma.Decimal;
  estado: CajaDeclaracionEstado;
};

export type CajaConfirmacionView = {
  id: string;
  declaracionId: string;
  importeConfirmado: Prisma.Decimal;
  confirmadoPorAdminId: string;
  confirmadoAt: Date;
};

export type CajaAplicacionView = {
  id: string;
  confirmacionId: string;
  obligacionId: string;
  vendedorId: string;
  importeAplicado: Prisma.Decimal;
  createdAt: Date;
  /** Presente cuando se enriquece con la obligación/ticket. */
  ticketId?: string;
  ticketCreatedAt?: Date;
};

export type CajaObligacionSaldoView = {
  obligacionId: string;
  ticketId: string;
  ticketCreatedAt: Date;
  vendedorId: string;
  bruto: Prisma.Decimal;
  comisionPorcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
  totalAplicado: Prisma.Decimal;
  pendiente: Prisma.Decimal;
};

export type CajaResumenVendedorView = {
  vendedorId: string;
  totales: CajaTotalesView;
  declaraciones: CajaDeclaracionView[];
  confirmaciones: CajaConfirmacionView[];
  aplicaciones: CajaAplicacionView[];
  obligaciones: CajaObligacionSaldoView[];
};
