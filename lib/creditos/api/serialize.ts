/**
 * Serialización segura de créditos para JSON HTTP.
 * Montos: string con 2 decimales. Instantes: ISO-8601 UTC.
 */
import { Prisma } from "@prisma/client";
import { moneyFixed2 } from "@/lib/creditos/money";
import type {
  CreditoCuentaView,
  CreditoMovimientoView,
  CreditosConfigView,
} from "@/lib/creditos/types";

export type CreditoMovimientoPublic = {
  id: string;
  tipo: string;
  importe: string;
  saldoAnterior: string;
  saldoPosterior: string;
  createdAt: string;
  motivo: string | null;
  actorAdminId: string | null;
  ticketId: string | null;
  movimientoOrigenId: string | null;
};

export type CreditosConfigPublic = {
  /** false = fila singleton ausente (defaults virtuales; no es “control apagado”). */
  configPersisted: boolean;
  controlActivo: boolean;
  inicioEn: string | null;
  umbralSaldoBajo: string | null;
  updatedAt: string;
  updatedByAdminId: string | null;
};

export function serializeDecimal(
  value: Prisma.Decimal | null | undefined,
): string | null {
  if (value == null) return null;
  return moneyFixed2(value);
}

export function serializeMovimiento(
  m: CreditoMovimientoView,
): CreditoMovimientoPublic {
  return {
    id: m.id,
    tipo: m.tipo,
    importe: moneyFixed2(m.importe),
    saldoAnterior: moneyFixed2(m.saldoAnterior),
    saldoPosterior: moneyFixed2(m.saldoPosterior),
    createdAt: m.createdAt.toISOString(),
    motivo: m.motivo,
    actorAdminId: m.actorAdminId,
    ticketId: m.ticketId,
    movimientoOrigenId: m.movimientoOrigenId,
  };
}

export function serializeConfig(c: CreditosConfigView): CreditosConfigPublic {
  return {
    configPersisted: c.configPersisted,
    controlActivo: c.controlActivo,
    inicioEn: c.inicioEn ? c.inicioEn.toISOString() : null,
    umbralSaldoBajo: serializeDecimal(c.umbralSaldoBajo),
    updatedAt: c.updatedAt.toISOString(),
    updatedByAdminId: c.updatedByAdminId,
  };
}

export function serializeCuentaBasica(
  cuenta: CreditoCuentaView | null,
  umbral: Prisma.Decimal | null,
): {
  saldoDisponible: string;
  tieneCuenta: boolean;
  saldoBajo: boolean;
  umbralSaldoBajo: string | null;
} {
  const saldo = cuenta?.saldoDisponible ?? new Prisma.Decimal(0);
  const saldoBajo =
    umbral != null && cuenta != null ? saldo.lte(umbral) : false;
  return {
    saldoDisponible: moneyFixed2(saldo),
    tieneCuenta: cuenta != null,
    saldoBajo,
    umbralSaldoBajo: serializeDecimal(umbral),
  };
}
