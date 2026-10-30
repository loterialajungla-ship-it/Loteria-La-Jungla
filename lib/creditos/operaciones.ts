/**
 * Operaciones de dominio de créditos (asignar, retirar, corregir, consumir, devolver).
 */
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { esTipoOrigenCorregible } from "@/lib/creditos/control";
import {
  CreditoDuplicateTicketMovimientoError,
  CreditoIdempotencyConflictError,
  CreditoValidationError,
  CreditoVendedorRequeridoError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  parseImporteCreditoPositivo,
  toCreditoDecimal,
} from "@/lib/creditos/money";
import { isCreditosSchemaMissing } from "@/lib/creditos/schema-guard";
import type { CreditosStore } from "@/lib/creditos/store";
import { ajustarEInsertarMovimiento } from "@/lib/creditos/tx-helpers";
import type {
  CorreccionEfecto,
  CreditoCuentaView,
  CreditoMovimientoView,
} from "@/lib/creditos/types";

function newId(): string {
  return `cm_${randomBytes(12).toString("hex")}`;
}

function requireVendedorId(vendedorId: string | null | undefined): string {
  const id = typeof vendedorId === "string" ? vendedorId.trim() : "";
  if (!id) {
    throw new CreditoVendedorRequeridoError();
  }
  return id;
}

function efectoDesdeSaldos(m: CreditoMovimientoView): CorreccionEfecto | null {
  if (m.saldoPosterior.gt(m.saldoAnterior)) return "AUMENTAR";
  if (m.saldoPosterior.lt(m.saldoAnterior)) return "DISMINUIR";
  return null;
}

async function replayOrConflict(args: {
  store: CreditosStore;
  idempotencyKey: string | null | undefined;
  expected: {
    vendedorId: string;
    tipo: CreditoMovimientoView["tipo"];
    importe: Prisma.Decimal;
    /** Obligatorio para CORRECCION. */
    efecto?: CorreccionEfecto;
  };
}): Promise<CreditoMovimientoView | null> {
  const key = args.idempotencyKey?.trim();
  if (!key) return null;
  const existing = await args.store.findMovimientoByIdempotencyKey(key);
  if (!existing) return null;
  if (
    existing.vendedorId !== args.expected.vendedorId ||
    existing.tipo !== args.expected.tipo ||
    !existing.importe.eq(args.expected.importe)
  ) {
    throw new CreditoIdempotencyConflictError();
  }
  if (args.expected.efecto) {
    const efecto = efectoDesdeSaldos(existing);
    if (efecto !== args.expected.efecto) {
      throw new CreditoIdempotencyConflictError(
        "Esta clave de créditos ya se usó con un efecto de corrección distinto.",
      );
    }
  }
  return existing;
}

export async function ensureVendedorCreditoCuenta(
  store: CreditosStore,
  vendedorId: string,
  ahora = new Date(),
): Promise<CreditoCuentaView> {
  const id = requireVendedorId(vendedorId);
  return store.runInTransaction((tx) => tx.ensureCuenta(id, ahora));
}

export async function asignarCreditos(
  store: CreditosStore,
  args: {
    vendedorId: string;
    importe: Prisma.Decimal | string | number;
    actorAdminId: string;
    motivo?: string | null;
    idempotencyKey?: string | null;
    ahora?: Date;
  },
): Promise<{ cuenta: CreditoCuentaView; movimiento: CreditoMovimientoView }> {
  const vendedorId = requireVendedorId(args.vendedorId);
  const importe = parseImporteCreditoPositivo(args.importe);
  const actorAdminId = args.actorAdminId.trim();
  if (!actorAdminId) {
    throw new CreditoValidationError("actorAdminId requerido.");
  }
  const ahora = args.ahora ?? new Date();
  const idemKey = args.idempotencyKey?.trim() || null;

  return store.runInTransaction(async (tx) => {
    const replay = await replayOrConflict({
      store: tx,
      idempotencyKey: idemKey,
      expected: { vendedorId, tipo: "ASIGNACION", importe },
    });
    if (replay) {
      const cuenta = await tx.ensureCuenta(vendedorId, ahora);
      return { cuenta, movimiento: replay };
    }

    await tx.ensureCuenta(vendedorId, ahora);
    const movimiento = await ajustarEInsertarMovimiento(tx, {
      vendedorId,
      delta: importe,
      ahora,
      buildMovimiento: (saldos) => ({
        id: newId(),
        vendedorId,
        tipo: "ASIGNACION",
        importe,
        ...saldos,
        createdAt: ahora,
        actorAdminId,
        motivo: args.motivo?.trim() || null,
        idempotencyKey: idemKey,
      }),
      onUnique: async () => {
        const again = await replayOrConflict({
          store: tx,
          idempotencyKey: idemKey,
          expected: { vendedorId, tipo: "ASIGNACION", importe },
        });
        if (again) return again;
        throw new CreditoIdempotencyConflictError();
      },
    });
    const cuenta = (await tx.getCuenta(vendedorId))!;
    return { cuenta, movimiento };
  });
}

export async function retirarCreditos(
  store: CreditosStore,
  args: {
    vendedorId: string;
    importe: Prisma.Decimal | string | number;
    actorAdminId: string;
    motivo?: string | null;
    idempotencyKey?: string | null;
    ahora?: Date;
  },
): Promise<{ cuenta: CreditoCuentaView; movimiento: CreditoMovimientoView }> {
  const vendedorId = requireVendedorId(args.vendedorId);
  const importe = parseImporteCreditoPositivo(args.importe);
  const actorAdminId = args.actorAdminId.trim();
  if (!actorAdminId) {
    throw new CreditoValidationError("actorAdminId requerido.");
  }
  const ahora = args.ahora ?? new Date();
  const idemKey = args.idempotencyKey?.trim() || null;

  return store.runInTransaction(async (tx) => {
    const replay = await replayOrConflict({
      store: tx,
      idempotencyKey: idemKey,
      expected: { vendedorId, tipo: "RETIRO", importe },
    });
    if (replay) {
      const cuenta = await tx.ensureCuenta(vendedorId, ahora);
      return { cuenta, movimiento: replay };
    }

    await tx.ensureCuenta(vendedorId, ahora);
    let movimiento: CreditoMovimientoView;
    try {
      movimiento = await ajustarEInsertarMovimiento(tx, {
        vendedorId,
        delta: importe.negated(),
        ahora,
        buildMovimiento: (saldos) => ({
          id: newId(),
          vendedorId,
          tipo: "RETIRO",
          importe,
          ...saldos,
          createdAt: ahora,
          actorAdminId,
          motivo: args.motivo?.trim() || null,
          idempotencyKey: idemKey,
        }),
        onUnique: async () => {
          const again = await replayOrConflict({
            store: tx,
            idempotencyKey: idemKey,
            expected: { vendedorId, tipo: "RETIRO", importe },
          });
          if (again) return again;
          throw new CreditoIdempotencyConflictError();
        },
      });
    } catch (e) {
      if (e instanceof InsufficientCreditoSaldoError) throw e;
      throw e;
    }
    const cuenta = (await tx.getCuenta(vendedorId))!;
    return { cuenta, movimiento };
  });
}

/**
 * Corrección compensatoria: no borra el movimiento original.
 * AUMENTAR → crédito; DISMINUIR → débito (rechaza si dejaría saldo < 0).
 *
 * v1: no se corrigen CONSUMO_VENTA ni DEVOLUCION_ANULACION (el reembolso
 * por anulación ya es íntegro e idempotente sobre el consumo).
 */
export async function registrarCorreccionCredito(
  store: CreditosStore,
  args: {
    vendedorId: string;
    importe: Prisma.Decimal | string | number;
    efecto: CorreccionEfecto;
    actorAdminId: string;
    movimientoOrigenId: string;
    motivo?: string | null;
    idempotencyKey?: string | null;
    ahora?: Date;
  },
): Promise<{ cuenta: CreditoCuentaView; movimiento: CreditoMovimientoView }> {
  const vendedorId = requireVendedorId(args.vendedorId);
  const importe = parseImporteCreditoPositivo(args.importe);
  const actorAdminId = args.actorAdminId.trim();
  if (!actorAdminId) {
    throw new CreditoValidationError("actorAdminId requerido.");
  }
  if (args.efecto !== "AUMENTAR" && args.efecto !== "DISMINUIR") {
    throw new CreditoValidationError("Efecto de corrección inválido.");
  }
  const ahora = args.ahora ?? new Date();
  const idemKey = args.idempotencyKey?.trim() || null;

  return store.runInTransaction(async (tx) => {
    const replay = await replayOrConflict({
      store: tx,
      idempotencyKey: idemKey,
      expected: {
        vendedorId,
        tipo: "CORRECCION",
        importe,
        efecto: args.efecto,
      },
    });
    if (replay) {
      const cuenta = await tx.ensureCuenta(vendedorId, ahora);
      return { cuenta, movimiento: replay };
    }

    const origen = await tx.findMovimientoById(args.movimientoOrigenId.trim());
    if (!origen) {
      throw new CreditoValidationError(
        "Movimiento original no encontrado.",
        "CREDITO_ORIGEN_NO_ENCONTRADO",
      );
    }
    if (origen.vendedorId !== vendedorId) {
      throw new CreditoValidationError(
        "El movimiento original no pertenece a este vendedor.",
        "CREDITO_ORIGEN_VENDEDOR",
      );
    }

    // Bloqueo de cuenta antes de política de origen y anti-duplicado
    // (evita TOCTOU concurrente: corrección vs otra corrección / anulación).
    await tx.ensureCuenta(vendedorId, ahora);
    await tx.lockCuentaForUpdate(vendedorId);

    if (!esTipoOrigenCorregible(origen.tipo)) {
      throw new CreditoValidationError(
        `No se puede corregir un movimiento de tipo ${origen.tipo}. El ciclo venta/anulación ya liquida consumo y devolución; use anulación o una corrección sobre asignación/retiro.`,
        "CREDITO_ORIGEN_NO_CORREGIBLE",
      );
    }

    // Una sola corrección por movimiento origen (idempotencia vía key aparte).
    const previos = await tx.listMovimientosByVendedor(vendedorId);
    const correccionExistente = previos.find(
      (m) =>
        m.tipo === "CORRECCION" && m.movimientoOrigenId === origen.id,
    );
    if (correccionExistente) {
      throw new CreditoValidationError(
        "Este movimiento ya tiene una corrección registrada.",
        "CREDITO_CORRECCION_DUPLICADA",
      );
    }

    const delta =
      args.efecto === "AUMENTAR" ? importe : importe.negated();
    const movimiento = await ajustarEInsertarMovimiento(tx, {
      vendedorId,
      delta,
      ahora,
      buildMovimiento: (saldos) => ({
        id: newId(),
        vendedorId,
        tipo: "CORRECCION",
        importe,
        ...saldos,
        createdAt: ahora,
        actorAdminId,
        movimientoOrigenId: origen.id,
        motivo: args.motivo?.trim() || null,
        idempotencyKey: idemKey,
      }),
      onUnique: async () => {
        const again = await replayOrConflict({
          store: tx,
          idempotencyKey: idemKey,
          expected: {
            vendedorId,
            tipo: "CORRECCION",
            importe,
            efecto: args.efecto,
          },
        });
        if (again) return again;
        throw new CreditoIdempotencyConflictError();
      },
    });
    const cuenta = (await tx.getCuenta(vendedorId))!;
    return { cuenta, movimiento };
  });
}

/**
 * Consumo por venta confirmada (dominio listo; aún no cableado a createTicket).
 * Un solo CONSUMO_VENTA por ticketId.
 */
export async function consumirCreditosPorVenta(
  store: CreditosStore,
  args: {
    vendedorId: string;
    ticketId: string;
    /** Importe = totalApostado del ticket. */
    importe: Prisma.Decimal | string | number;
    ahora?: Date;
  },
): Promise<{ cuenta: CreditoCuentaView; movimiento: CreditoMovimientoView }> {
  const vendedorId = requireVendedorId(args.vendedorId);
  const ticketId = args.ticketId.trim();
  if (!ticketId) {
    throw new CreditoValidationError("ticketId requerido.");
  }
  const importe = parseImporteCreditoPositivo(args.importe);
  const ahora = args.ahora ?? new Date();

  return store.runInTransaction(async (tx) => {
    const existing = await tx.findMovimientoByTicketTipo(
      ticketId,
      "CONSUMO_VENTA",
    );
    if (existing) {
      if (
        existing.vendedorId !== vendedorId ||
        !existing.importe.eq(importe)
      ) {
        throw new CreditoDuplicateTicketMovimientoError("CONSUMO_VENTA");
      }
      const cuenta = await tx.ensureCuenta(vendedorId, ahora);
      return { cuenta, movimiento: existing };
    }

    await tx.ensureCuenta(vendedorId, ahora);
    const movimiento = await ajustarEInsertarMovimiento(tx, {
      vendedorId,
      delta: importe.negated(),
      ahora,
      buildMovimiento: (saldos) => ({
        id: newId(),
        vendedorId,
        tipo: "CONSUMO_VENTA",
        importe,
        ...saldos,
        createdAt: ahora,
        ticketId,
      }),
      onUnique: async () => {
        const race = await tx.findMovimientoByTicketTipo(
          ticketId,
          "CONSUMO_VENTA",
        );
        if (
          race &&
          race.vendedorId === vendedorId &&
          race.importe.eq(importe)
        ) {
          return race;
        }
        throw new CreditoDuplicateTicketMovimientoError("CONSUMO_VENTA");
      },
    });
    const cuenta = (await tx.getCuenta(vendedorId))!;
    return { cuenta, movimiento };
  });
}

/**
 * Devolución por anulación (misma TX que anularTicket).
 * Idempotente: un DEVOLUCION_ANULACION por ticket; requiere CONSUMO previo.
 *
 * Si la consulta inicial de CONSUMO_VENTA falla por esquema ausente (P2021),
 * se trata como skippedSinConsumo: sin tablas de créditos no puede haber deuda
 * registrada. Cualquier otro fallo (incl. esquema al insertar devolución) se
 * propaga sin convertir en ausencia de consumo.
 */
export async function devolverCreditosPorAnulacion(
  store: CreditosStore,
  args: {
    ticketId: string;
    actorAdminId?: string | null;
    ahora?: Date;
  },
): Promise<{
  cuenta: CreditoCuentaView | null;
  movimiento: CreditoMovimientoView | null;
  /** true si no había consumo (p. ej. venta pre-control o esquema ausente) → no-op. */
  skippedSinConsumo: boolean;
}> {
  const ticketId = args.ticketId.trim();
  if (!ticketId) {
    throw new CreditoValidationError("ticketId requerido.");
  }
  const ahora = args.ahora ?? new Date();

  return store.runInTransaction(async (tx) => {
    let consumo;
    try {
      consumo = await tx.findMovimientoByTicketTipo(
        ticketId,
        "CONSUMO_VENTA",
      );
    } catch (error) {
      // Única captura de esquema ausente: solo la búsqueda inicial de consumo.
      if (isCreditosSchemaMissing(error)) {
        return { cuenta: null, movimiento: null, skippedSinConsumo: true };
      }
      throw error;
    }
    if (!consumo) {
      return { cuenta: null, movimiento: null, skippedSinConsumo: true };
    }

    const existing = await tx.findMovimientoByTicketTipo(
      ticketId,
      "DEVOLUCION_ANULACION",
    );
    if (existing) {
      const cuenta = await tx.ensureCuenta(consumo.vendedorId, ahora);
      return { cuenta, movimiento: existing, skippedSinConsumo: false };
    }

    const importe = toCreditoDecimal(consumo.importe);
    const movimiento = await ajustarEInsertarMovimiento(tx, {
      vendedorId: consumo.vendedorId,
      delta: importe,
      ahora,
      buildMovimiento: (saldos) => ({
        id: newId(),
        vendedorId: consumo.vendedorId,
        tipo: "DEVOLUCION_ANULACION",
        importe,
        ...saldos,
        createdAt: ahora,
        actorAdminId: args.actorAdminId?.trim() || null,
        ticketId,
        movimientoOrigenId: consumo.id,
        motivo: "Devolución por anulación de ticket",
      }),
      onUnique: async () => {
        const race = await tx.findMovimientoByTicketTipo(
          ticketId,
          "DEVOLUCION_ANULACION",
        );
        if (race) return race;
        throw new CreditoDuplicateTicketMovimientoError("DEVOLUCION_ANULACION");
      },
    });
    const cuenta = (await tx.getCuenta(consumo.vendedorId))!;
    return { cuenta, movimiento, skippedSinConsumo: false };
  });
}

export async function consultarSaldoYHistorial(
  store: CreditosStore,
  vendedorId: string,
): Promise<{
  cuenta: CreditoCuentaView | null;
  movimientos: CreditoMovimientoView[];
}> {
  const id = requireVendedorId(vendedorId);
  const cuenta = await store.getCuenta(id);
  const movimientos = await store.listMovimientosByVendedor(id);
  return { cuenta, movimientos };
}
