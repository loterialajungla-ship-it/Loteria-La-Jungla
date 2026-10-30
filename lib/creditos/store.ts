/**
 * Puerto de persistencia de créditos (inyectable).
 * La implementación en memoria sirve a unit tests sin Neon.
 * La adaptación Prisma real se cableará en fases posteriores.
 *
 * ## Concurrencia
 *
 * Memoria (`createMemoryCreditosStore`): serializa TX en un proceso — solo tests.
 * PostgreSQL (`createPrismaCreditosStore`): UPDATE condicional atómico
 *   WHERE saldo+delta >= 0 RETURNING … (ver prisma-store.ts).
 * Compensación si UNIQUE tras ajuste: `ajustarEInsertarMovimiento`.
 */
import { Prisma, type TipoCreditoMovimiento } from "@prisma/client";
import type {
  CreditoCuentaView,
  CreditoMovimientoView,
  CreditosConfigView,
} from "@/lib/creditos/types";
import {
  assertSaldoNoNegativo,
  creditoZero,
  toCreditoDecimal,
} from "@/lib/creditos/money";
import {
  CreditoConfigError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";

export type NuevoCreditoMovimiento = {
  id: string;
  vendedorId: string;
  tipo: TipoCreditoMovimiento;
  importe: Prisma.Decimal;
  saldoAnterior: Prisma.Decimal;
  saldoPosterior: Prisma.Decimal;
  createdAt?: Date;
  actorAdminId?: string | null;
  ticketId?: string | null;
  movimientoOrigenId?: string | null;
  motivo?: string | null;
  idempotencyKey?: string | null;
};

export type CreditosStore = {
  /**
   * Ejecuta trabajo de forma atómica respecto a esta tienda.
   * En Prisma será `$transaction`; en memoria serializa mutaciones.
   */
  runInTransaction: <T>(fn: (tx: CreditosStore) => Promise<T>) => Promise<T>;

  ensureCuenta: (vendedorId: string, ahora?: Date) => Promise<CreditoCuentaView>;
  getCuenta: (vendedorId: string) => Promise<CreditoCuentaView | null>;

  /**
   * Bloqueo de fila de cuenta (SELECT … FOR UPDATE) dentro de la TX abierta.
   * Evita TOCTOU en comprobaciones de unicidad lógica (p. ej. una corrección
   * por movimiento origen) antes del UPDATE de saldo.
   * En memoria: no-op (runInTransaction ya serializa).
   */
  lockCuentaForUpdate: (vendedorId: string) => Promise<void>;

  /**
   * Ajuste atómico del saldo. `delta` > 0 suma; `delta` < 0 resta.
   * Falla (null / throw) si el resultado sería negativo.
   * Devuelve saldos anterior/posterior tras el ajuste.
   */
  ajustarSaldoAtomico: (args: {
    vendedorId: string;
    delta: Prisma.Decimal;
    ahora?: Date;
  }) => Promise<{ saldoAnterior: Prisma.Decimal; saldoPosterior: Prisma.Decimal }>;

  insertMovimiento: (
    mov: NuevoCreditoMovimiento,
  ) => Promise<CreditoMovimientoView>;

  findMovimientoByIdempotencyKey: (
    key: string,
  ) => Promise<CreditoMovimientoView | null>;

  findMovimientoByTicketTipo: (
    ticketId: string,
    tipo: TipoCreditoMovimiento,
  ) => Promise<CreditoMovimientoView | null>;

  findMovimientoById: (id: string) => Promise<CreditoMovimientoView | null>;

  listMovimientosByVendedor: (
    vendedorId: string,
  ) => Promise<CreditoMovimientoView[]>;

  getConfig: () => Promise<CreditosConfigView>;

  saveConfig: (
    patch: Partial<{
      controlActivo: boolean;
      inicioEn: Date | null;
      umbralSaldoBajo: Prisma.Decimal | null;
      updatedByAdminId: string | null;
    }>,
    ahora?: Date,
  ) => Promise<CreditosConfigView>;
};

function cloneMov(m: CreditoMovimientoView): CreditoMovimientoView {
  return {
    ...m,
    importe: new Prisma.Decimal(m.importe),
    saldoAnterior: new Prisma.Decimal(m.saldoAnterior),
    saldoPosterior: new Prisma.Decimal(m.saldoPosterior),
    createdAt: new Date(m.createdAt),
  };
}

/**
 * Tienda en memoria para unit tests. Sin red ni PrismaClient.
 */
export function createMemoryCreditosStore(): CreditosStore {
  const cuentas = new Map<
    string,
    { saldo: Prisma.Decimal; createdAt: Date; updatedAt: Date }
  >();
  const movimientos: CreditoMovimientoView[] = [];
  // Memoria: singleton siempre “persistido” (control off explícito de tests).
  let config: CreditosConfigView = {
    controlActivo: false,
    inicioEn: null,
    umbralSaldoBajo: null,
    updatedAt: new Date(0),
    updatedByAdminId: null,
    configPersisted: true,
  };
  let chain: Promise<unknown> = Promise.resolve();

  const api: CreditosStore = {
    async runInTransaction(fn) {
      const run = chain.then(() => fn(api));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    async lockCuentaForUpdate() {
      // Serialización ya garantizada por runInTransaction en memoria.
    },

    async ensureCuenta(vendedorId, ahora = new Date()) {
      const id = vendedorId.trim();
      let row = cuentas.get(id);
      if (!row) {
        row = {
          saldo: creditoZero(),
          createdAt: ahora,
          updatedAt: ahora,
        };
        cuentas.set(id, row);
      }
      return {
        vendedorId: id,
        saldoDisponible: new Prisma.Decimal(row.saldo),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async getCuenta(vendedorId) {
      const row = cuentas.get(vendedorId.trim());
      if (!row) return null;
      return {
        vendedorId: vendedorId.trim(),
        saldoDisponible: new Prisma.Decimal(row.saldo),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async ajustarSaldoAtomico({ vendedorId, delta, ahora = new Date() }) {
      const id = vendedorId.trim();
      let row = cuentas.get(id);
      if (!row) {
        row = {
          saldo: creditoZero(),
          createdAt: ahora,
          updatedAt: ahora,
        };
        cuentas.set(id, row);
      }
      const saldoAnterior = new Prisma.Decimal(row.saldo);
      const saldoPosterior = saldoAnterior.plus(delta);
      if (saldoPosterior.lt(0)) {
        throw new InsufficientCreditoSaldoError();
      }
      assertSaldoNoNegativo(saldoPosterior);
      row.saldo = saldoPosterior;
      row.updatedAt = ahora;
      return { saldoAnterior, saldoPosterior };
    },

    async insertMovimiento(mov) {
      if (
        mov.idempotencyKey &&
        movimientos.some((m) => m.idempotencyKey === mov.idempotencyKey)
      ) {
        const err = new Error("UNIQUE idempotencyKey");
        (err as { code?: string }).code = "P2002";
        throw err;
      }
      if (mov.ticketId) {
        const dup = movimientos.find(
          (m) => m.ticketId === mov.ticketId && m.tipo === mov.tipo,
        );
        if (dup) {
          const err = new Error("UNIQUE ticketId+tipo");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
      }
      const view: CreditoMovimientoView = {
        id: mov.id,
        vendedorId: mov.vendedorId,
        tipo: mov.tipo,
        importe: toCreditoDecimal(mov.importe),
        saldoAnterior: toCreditoDecimal(mov.saldoAnterior),
        saldoPosterior: toCreditoDecimal(mov.saldoPosterior),
        createdAt: mov.createdAt ?? new Date(),
        actorAdminId: mov.actorAdminId ?? null,
        ticketId: mov.ticketId ?? null,
        movimientoOrigenId: mov.movimientoOrigenId ?? null,
        motivo: mov.motivo ?? null,
        idempotencyKey: mov.idempotencyKey ?? null,
      };
      movimientos.push(view);
      return cloneMov(view);
    },

    async findMovimientoByIdempotencyKey(key) {
      const m = movimientos.find((x) => x.idempotencyKey === key);
      return m ? cloneMov(m) : null;
    },

    async findMovimientoByTicketTipo(ticketId, tipo) {
      const m = movimientos.find(
        (x) => x.ticketId === ticketId && x.tipo === tipo,
      );
      return m ? cloneMov(m) : null;
    },

    async findMovimientoById(id) {
      const m = movimientos.find((x) => x.id === id);
      return m ? cloneMov(m) : null;
    },

    async listMovimientosByVendedor(vendedorId) {
      return movimientos
        .filter((m) => m.vendedorId === vendedorId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(cloneMov);
    },

    async getConfig() {
      return {
        ...config,
        umbralSaldoBajo:
          config.umbralSaldoBajo == null
            ? null
            : new Prisma.Decimal(config.umbralSaldoBajo),
        inicioEn: config.inicioEn ? new Date(config.inicioEn) : null,
        updatedAt: new Date(config.updatedAt),
      };
    },

    async saveConfig(patch, ahora = new Date()) {
      if (!config.configPersisted) {
        throw new CreditoConfigError(
          "La configuración de créditos no está inicializada. Ejecute el procedimiento operativo de bootstrap antes de modificarla.",
          "CREDITOS_CONFIG_NO_INICIALIZADA",
        );
      }
      config = {
        controlActivo: patch.controlActivo ?? config.controlActivo,
        inicioEn:
          patch.inicioEn !== undefined ? patch.inicioEn : config.inicioEn,
        umbralSaldoBajo:
          patch.umbralSaldoBajo !== undefined
            ? patch.umbralSaldoBajo
            : config.umbralSaldoBajo,
        updatedByAdminId:
          patch.updatedByAdminId !== undefined
            ? patch.updatedByAdminId
            : config.updatedByAdminId,
        updatedAt: ahora,
        configPersisted: true,
      };
      return api.getConfig();
    },
  };

  return api;
}
