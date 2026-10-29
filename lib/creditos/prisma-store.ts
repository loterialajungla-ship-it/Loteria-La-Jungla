/**
 * Adaptador Prisma de CreditosStore.
 *
 * Concurrencia: UPDATE condicional atómico del saldo
 *   WHERE "saldoDisponible" + delta >= 0
 *   RETURNING anterior/posterior
 * dentro de la misma TX que inserta el movimiento.
 *
 * Uso dentro de una TX ya abierta:
 *   createPrismaCreditosStore(tx, { alreadyInTransaction: true })
 *
 * Uso autónomo (abre $transaction):
 *   createPrismaCreditosStore(prisma)
 */
import { Prisma, type PrismaClient, type TipoCreditoMovimiento } from "@prisma/client";
import {
  CreditoValidationError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import { creditoZero, toCreditoDecimal } from "@/lib/creditos/money";
import type {
  CreditosStore,
  NuevoCreditoMovimiento,
} from "@/lib/creditos/store";
import type {
  CreditoMovimientoView,
  CreditosConfigView,
} from "@/lib/creditos/types";

type PrismaLike = {
  $queryRaw: PrismaClient["$queryRaw"];
  $transaction?: PrismaClient["$transaction"];
  vendedorCreditoCuenta: PrismaClient["vendedorCreditoCuenta"];
  creditoMovimiento: PrismaClient["creditoMovimiento"];
  creditosConfig: PrismaClient["creditosConfig"];
};

export type CreatePrismaCreditosStoreOptions = {
  /**
   * true = el cliente ya es un TransactionClient; runInTransaction no anida.
   */
  alreadyInTransaction?: boolean;
};

type SaldoRow = {
  saldo_anterior: Prisma.Decimal | string;
  saldo_posterior: Prisma.Decimal | string;
};

function mapMovimiento(row: {
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
}): CreditoMovimientoView {
  return {
    id: row.id,
    vendedorId: row.vendedorId,
    tipo: row.tipo,
    importe: toCreditoDecimal(row.importe),
    saldoAnterior: toCreditoDecimal(row.saldoAnterior),
    saldoPosterior: toCreditoDecimal(row.saldoPosterior),
    createdAt: row.createdAt,
    actorAdminId: row.actorAdminId,
    ticketId: row.ticketId,
    movimientoOrigenId: row.movimientoOrigenId,
    motivo: row.motivo,
    idempotencyKey: row.idempotencyKey,
  };
}

function defaultConfig(updatedAt = new Date(0)): CreditosConfigView {
  return {
    controlActivo: false,
    inicioEn: null,
    umbralSaldoBajo: null,
    updatedAt,
    updatedByAdminId: null,
    configPersisted: false,
  };
}

export function createPrismaCreditosStore(
  client: PrismaLike,
  options: CreatePrismaCreditosStoreOptions = {},
): CreditosStore {
  const alreadyInTransaction = options.alreadyInTransaction === true;

  const store: CreditosStore = {
    async runInTransaction(fn) {
      if (alreadyInTransaction || typeof client.$transaction !== "function") {
        return fn(store);
      }
      return client.$transaction(
        async (tx) => {
          const nested = createPrismaCreditosStore(tx as unknown as PrismaLike, {
            alreadyInTransaction: true,
          });
          return fn(nested);
        },
        { maxWait: 30_000, timeout: 60_000 },
      );
    },

    async ensureCuenta(vendedorId, ahora = new Date()) {
      const id = vendedorId.trim();
      const row = await client.vendedorCreditoCuenta.upsert({
        where: { vendedorId: id },
        create: {
          vendedorId: id,
          saldoDisponible: creditoZero(),
          createdAt: ahora,
          updatedAt: ahora,
        },
        update: {},
      });
      return {
        vendedorId: row.vendedorId,
        saldoDisponible: toCreditoDecimal(row.saldoDisponible),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async lockCuentaForUpdate(vendedorId) {
      const id = vendedorId.trim();
      // Parametrizado — sin concatenar input. Debe ejecutarse dentro de la TX.
      const rows = await client.$queryRaw<Array<{ vendedorId: string }>>`
        SELECT "vendedorId" FROM "VendedorCreditoCuenta"
        WHERE "vendedorId" = ${id}
        FOR UPDATE
      `;
      if (!rows[0]) {
        throw new CreditoValidationError(
          "Cuenta de créditos no disponible para bloqueo.",
          "CREDITO_CUENTA_LOCK",
        );
      }
    },

    async getCuenta(vendedorId) {
      const row = await client.vendedorCreditoCuenta.findUnique({
        where: { vendedorId: vendedorId.trim() },
      });
      if (!row) return null;
      return {
        vendedorId: row.vendedorId,
        saldoDisponible: toCreditoDecimal(row.saldoDisponible),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async ajustarSaldoAtomico({ vendedorId, delta, ahora = new Date() }) {
      const id = vendedorId.trim();
      const deltaDec = toCreditoDecimal(delta);

      // Parametrizado (Prisma.sql / tagged template) — sin concatenar input.
      const rows = await client.$queryRaw<SaldoRow[]>`
        UPDATE "VendedorCreditoCuenta"
        SET
          "saldoDisponible" = "saldoDisponible" + ${deltaDec},
          "updatedAt" = ${ahora}
        WHERE "vendedorId" = ${id}
          AND "saldoDisponible" + ${deltaDec} >= 0
        RETURNING
          ("saldoDisponible" - ${deltaDec}) AS "saldo_anterior",
          "saldoDisponible" AS "saldo_posterior"
      `;

      if (!rows[0]) {
        throw new InsufficientCreditoSaldoError();
      }

      return {
        saldoAnterior: toCreditoDecimal(rows[0].saldo_anterior),
        saldoPosterior: toCreditoDecimal(rows[0].saldo_posterior),
      };
    },

    async insertMovimiento(mov: NuevoCreditoMovimiento) {
      try {
        const row = await client.creditoMovimiento.create({
          data: {
            id: mov.id,
            vendedorId: mov.vendedorId,
            tipo: mov.tipo,
            importe: mov.importe,
            saldoAnterior: mov.saldoAnterior,
            saldoPosterior: mov.saldoPosterior,
            createdAt: mov.createdAt ?? new Date(),
            actorAdminId: mov.actorAdminId ?? null,
            ticketId: mov.ticketId ?? null,
            movimientoOrigenId: mov.movimientoOrigenId ?? null,
            motivo: mov.motivo ?? null,
            idempotencyKey: mov.idempotencyKey ?? null,
          },
        });
        return mapMovimiento(row);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const err = new Error("UNIQUE CreditoMovimiento");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        throw error;
      }
    },

    async findMovimientoByIdempotencyKey(key) {
      const row = await client.creditoMovimiento.findUnique({
        where: { idempotencyKey: key },
      });
      return row ? mapMovimiento(row) : null;
    },

    async findMovimientoByTicketTipo(ticketId, tipo) {
      const row = await client.creditoMovimiento.findUnique({
        where: {
          ticketId_tipo: { ticketId, tipo },
        },
      });
      return row ? mapMovimiento(row) : null;
    },

    async findMovimientoById(id) {
      const row = await client.creditoMovimiento.findUnique({ where: { id } });
      return row ? mapMovimiento(row) : null;
    },

    async listMovimientosByVendedor(vendedorId) {
      const rows = await client.creditoMovimiento.findMany({
        where: { vendedorId: vendedorId.trim() },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapMovimiento);
    },

    async getConfig() {
      const row = await client.creditosConfig.findUnique({ where: { id: 1 } });
      if (!row) return defaultConfig();
      return {
        controlActivo: row.controlActivo,
        inicioEn: row.inicioEn,
        umbralSaldoBajo:
          row.umbralSaldoBajo == null
            ? null
            : toCreditoDecimal(row.umbralSaldoBajo),
        updatedAt: row.updatedAt,
        updatedByAdminId: row.updatedByAdminId,
        configPersisted: true,
      };
    },

    async saveConfig(patch, ahora = new Date()) {
      const actual = await store.getConfig();
      const row = await client.creditosConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          controlActivo: patch.controlActivo ?? false,
          inicioEn: patch.inicioEn !== undefined ? patch.inicioEn : null,
          umbralSaldoBajo:
            patch.umbralSaldoBajo !== undefined ? patch.umbralSaldoBajo : null,
          updatedAt: ahora,
          updatedByAdminId: patch.updatedByAdminId ?? null,
        },
        update: {
          controlActivo: patch.controlActivo ?? actual.controlActivo,
          inicioEn:
            patch.inicioEn !== undefined ? patch.inicioEn : actual.inicioEn,
          umbralSaldoBajo:
            patch.umbralSaldoBajo !== undefined
              ? patch.umbralSaldoBajo
              : actual.umbralSaldoBajo,
          updatedAt: ahora,
          updatedByAdminId:
            patch.updatedByAdminId !== undefined
              ? patch.updatedByAdminId
              : actual.updatedByAdminId,
        },
      });
      return {
        controlActivo: row.controlActivo,
        inicioEn: row.inicioEn,
        umbralSaldoBajo:
          row.umbralSaldoBajo == null
            ? null
            : toCreditoDecimal(row.umbralSaldoBajo),
        updatedAt: row.updatedAt,
        updatedByAdminId: row.updatedByAdminId,
        configPersisted: true,
      };
    },
  };

  return store;
}
