/**
 * Reglas puras del control de créditos (sin I/O).
 *
 * Fecha de corte: Ticket.createdAt (instante) comparado con CreditosConfig.inicioEn.
 * NO usar fechaJuego.
 *
 * inicioEn se almacena como DateTime absoluto (UTC en DB). Quien configure
 * “inicio del día D en America/Caracas” debe convertir ese instante local a UTC
 * antes de persistir (fase admin posterior).
 */
import { Prisma, type RolUsuario, type TipoCreditoMovimiento } from "@prisma/client";
import { moneyEq, toCreditoDecimal } from "@/lib/creditos/money";

export type CreditosControlSnapshot = {
  controlActivo: boolean;
  /** Null = sin fecha de inicio → nunca hay consumo automático. */
  inicioEn: Date | null;
  umbralSaldoBajo: Prisma.Decimal | null;
};

/**
 * Orígenes no corregibles en v1: el ciclo venta↔anulación ya liquida
 * CONSUMO / DEVOLUCION de forma íntegra e idempotente. Una CORRECCION
 * sobre ellos permitiría sobrerreembolso o sub-reembolso al anular.
 */
export const TIPOS_ORIGEN_CORRECCION_PROHIBIDOS = [
  "CONSUMO_VENTA",
  "DEVOLUCION_ANULACION",
] as const satisfies ReadonlyArray<TipoCreditoMovimiento>;

export type TipoOrigenCorreccionProhibido =
  (typeof TIPOS_ORIGEN_CORRECCION_PROHIBIDOS)[number];

/** ASIGNACION, RETIRO y CORRECCION sí admiten compensación administrativa. */
export function esTipoOrigenCorregible(tipo: TipoCreditoMovimiento): boolean {
  return !(TIPOS_ORIGEN_CORRECCION_PROHIBIDOS as readonly string[]).includes(
    tipo,
  );
}

/**
 * ¿La venta consumiría créditos si se integrara el flujo?
 *
 * Requiere: control activo + inicioEn definido + rol ≠ ADMIN + vendedorId
 * + createdAt >= inicioEn.
 *
 * Tickets históricos sin vendedor → false (no se inventa propietario).
 * ADMIN en POS → false (exento).
 * Control desactivado o inicioEn null → false (preparación de saldos sin cobro).
 */
export function ventaSujetaAControlCreditos(args: {
  config: CreditosControlSnapshot;
  /** Rol del actor que confirma la venta. */
  actorRol: RolUsuario;
  /** Ticket.vendedorId — null en históricos. */
  vendedorId: string | null | undefined;
  /** Ticket.createdAt — instante real de confirmación. */
  ticketCreatedAt: Date;
  /**
   * Solo para tests de regresión: si se pasa, se ignora a propósito
   * (fechaJuego NUNCA participa en la decisión).
   */
  fechaJuegoIgnorada?: Date;
}): boolean {
  void args.fechaJuegoIgnorada;

  if (!args.config.controlActivo) return false;
  if (args.config.inicioEn == null) return false;
  if (args.actorRol === "ADMIN") return false;
  if (!args.vendedorId) return false;

  return args.ticketCreatedAt.getTime() >= args.config.inicioEn.getTime();
}

/** Saldo en o por debajo del umbral configurado (umbral null → nunca alerta). */
export function esSaldoBajo(
  saldoDisponible: Prisma.Decimal | string,
  umbralSaldoBajo: Prisma.Decimal | string | null | undefined,
): boolean {
  if (umbralSaldoBajo == null) return false;
  const saldo = toCreditoDecimal(saldoDisponible);
  const umbral = toCreditoDecimal(umbralSaldoBajo);
  return saldo.lte(umbral);
}

/**
 * Suma neta esperada del libro para coherencia con saldo materializado.
 * ASIGNACION / DEVOLUCION_ANULACION: +importe
 * RETIRO / CONSUMO_VENTA: −importe
 * CORRECCION: saldoPosterior − saldoAnterior (efecto real)
 */
export function efectoNetoMovimiento(args: {
  tipo:
    | "ASIGNACION"
    | "RETIRO"
    | "CONSUMO_VENTA"
    | "DEVOLUCION_ANULACION"
    | "CORRECCION";
  importe: Prisma.Decimal;
  saldoAnterior: Prisma.Decimal;
  saldoPosterior: Prisma.Decimal;
}): Prisma.Decimal {
  switch (args.tipo) {
    case "ASIGNACION":
    case "DEVOLUCION_ANULACION":
      return args.importe;
    case "RETIRO":
    case "CONSUMO_VENTA":
      return args.importe.negated();
    case "CORRECCION":
      return args.saldoPosterior.minus(args.saldoAnterior);
    default: {
      const _exhaustive: never = args.tipo;
      return _exhaustive;
    }
  }
}

export function saldoEsperadoDesdeMovimientos(
  movimientos: readonly {
    tipo:
      | "ASIGNACION"
      | "RETIRO"
      | "CONSUMO_VENTA"
      | "DEVOLUCION_ANULACION"
      | "CORRECCION";
    importe: Prisma.Decimal;
    saldoAnterior: Prisma.Decimal;
    saldoPosterior: Prisma.Decimal;
  }[],
): Prisma.Decimal {
  let acc = new Prisma.Decimal(0);
  for (const m of movimientos) {
    acc = acc.plus(efectoNetoMovimiento(m));
  }
  return acc;
}

export function cuentaCoherenteConLibro(
  saldoDisponible: Prisma.Decimal,
  movimientos: Parameters<typeof saldoEsperadoDesdeMovimientos>[0],
): boolean {
  return moneyEq(saldoDisponible, saldoEsperadoDesdeMovimientos(movimientos));
}

/**
 * Valida que saldoAnterior/Posterior + importe sean aritméticamente coherentes
 * con el tipo (misma regla que el CHECK SQL de la migración).
 */
export function movimientoSaldosCoherentesConTipo(args: {
  tipo:
    | "ASIGNACION"
    | "RETIRO"
    | "CONSUMO_VENTA"
    | "DEVOLUCION_ANULACION"
    | "CORRECCION";
  importe: Prisma.Decimal;
  saldoAnterior: Prisma.Decimal;
  saldoPosterior: Prisma.Decimal;
}): boolean {
  const { tipo, importe, saldoAnterior, saldoPosterior } = args;
  if (saldoAnterior.lt(0) || saldoPosterior.lt(0) || importe.lte(0)) {
    return false;
  }
  switch (tipo) {
    case "ASIGNACION":
    case "DEVOLUCION_ANULACION":
      return moneyEq(saldoPosterior, saldoAnterior.plus(importe));
    case "RETIRO":
    case "CONSUMO_VENTA":
      return moneyEq(saldoPosterior, saldoAnterior.minus(importe));
    case "CORRECCION":
      return (
        moneyEq(saldoPosterior, saldoAnterior.plus(importe)) ||
        moneyEq(saldoPosterior, saldoAnterior.minus(importe))
      );
    default: {
      const _exhaustive: never = tipo;
      return _exhaustive;
    }
  }
}
