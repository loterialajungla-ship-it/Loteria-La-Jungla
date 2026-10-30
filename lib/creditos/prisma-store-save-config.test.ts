/**
 * Defensa en profundidad: saveConfig solo UPDATE, nunca crea CreditosConfig.
 * Mock Prisma — sin Neon.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { CreditoConfigError } from "@/lib/creditos/errors";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import { asignarCreditos } from "@/lib/creditos/operaciones";
import { createMemoryCreditosStore } from "@/lib/creditos/store";

type ConfigRow = {
  id: number;
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo: Prisma.Decimal | null;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

function createMockPrisma(opts: { initialRow: ConfigRow | null }) {
  let row: ConfigRow | null = opts.initialRow
    ? { ...opts.initialRow }
    : null;
  let createCalls = 0;
  let upsertCalls = 0;
  let updateCalls = 0;

  const client = {
    async $queryRaw() {
      return [];
    },
    vendedorCreditoCuenta: {} as never,
    creditoMovimiento: {} as never,
    creditosConfig: {
      async findUnique(args: { where: { id: number } }) {
        if (args.where.id !== 1) return null;
        return row ? { ...row } : null;
      },
      async create() {
        createCalls += 1;
        throw new Error("create no debe llamarse desde saveConfig");
      },
      async upsert() {
        upsertCalls += 1;
        throw new Error("upsert no debe llamarse desde saveConfig");
      },
      async update(args: {
        where: { id: number };
        data: Partial<ConfigRow>;
      }) {
        updateCalls += 1;
        if (!row || args.where.id !== 1) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Record to update not found.",
            {
              code: "P2025",
              clientVersion: "5.22.0",
              meta: { cause: "Record to update not found." },
            },
          );
        }
        row = {
          ...row,
          controlActivo: args.data.controlActivo ?? row.controlActivo,
          inicioEn:
            args.data.inicioEn !== undefined ? args.data.inicioEn : row.inicioEn,
          umbralSaldoBajo:
            args.data.umbralSaldoBajo !== undefined
              ? args.data.umbralSaldoBajo
              : row.umbralSaldoBajo,
          updatedAt: args.data.updatedAt ?? row.updatedAt,
          updatedByAdminId:
            args.data.updatedByAdminId !== undefined
              ? args.data.updatedByAdminId
              : row.updatedByAdminId,
        };
        return { ...row };
      },
    },
  };

  return {
    client,
    get row() {
      return row;
    },
    stats: () => ({ createCalls, upsertCalls, updateCalls }),
  };
}

describe("prisma-store saveConfig — solo update", () => {
  it("con fila existente, actualiza correctamente", async () => {
    const mock = createMockPrisma({
      initialRow: {
        id: 1,
        controlActivo: false,
        inicioEn: null,
        umbralSaldoBajo: null,
        updatedAt: new Date(0),
        updatedByAdminId: null,
      },
    });
    const store = createPrismaCreditosStore(mock.client as never, {
      alreadyInTransaction: true,
    });
    const out = await store.saveConfig({
      umbralSaldoBajo: new Prisma.Decimal("12.50"),
      updatedByAdminId: "admin-1",
    });
    assert.equal(out.configPersisted, true);
    assert.equal(out.umbralSaldoBajo?.toFixed(2), "12.50");
    assert.equal(out.updatedByAdminId, "admin-1");
    assert.equal(mock.stats().updateCalls, 1);
    assert.equal(mock.stats().createCalls, 0);
    assert.equal(mock.stats().upsertCalls, 0);
    assert.equal(mock.row?.umbralSaldoBajo?.toFixed(2), "12.50");
  });

  it("sin fila, falla con CREDITOS_CONFIG_NO_INICIALIZADA", async () => {
    const mock = createMockPrisma({ initialRow: null });
    const store = createPrismaCreditosStore(mock.client as never, {
      alreadyInTransaction: true,
    });
    await assert.rejects(
      () =>
        store.saveConfig({
          controlActivo: false,
          updatedByAdminId: "admin-1",
        }),
      (e: unknown) =>
        e instanceof CreditoConfigError &&
        e.code === "CREDITOS_CONFIG_NO_INICIALIZADA",
    );
    assert.equal(mock.stats().updateCalls, 0);
    assert.equal(mock.stats().createCalls, 0);
    assert.equal(mock.stats().upsertCalls, 0);
  });

  it("sin fila, no crea registros", async () => {
    const mock = createMockPrisma({ initialRow: null });
    const store = createPrismaCreditosStore(mock.client as never, {
      alreadyInTransaction: true,
    });
    await assert.rejects(() =>
      store.saveConfig({ updatedByAdminId: "a" }),
    );
    assert.equal(mock.row, null);
    assert.equal(mock.stats().createCalls, 0);
    assert.equal(mock.stats().upsertCalls, 0);
  });

  it("si falla, no modifica créditos (fila ausente)", async () => {
    const mock = createMockPrisma({ initialRow: null });
    const store = createPrismaCreditosStore(mock.client as never, {
      alreadyInTransaction: true,
    });
    await assert.rejects(() =>
      store.saveConfig({
        controlActivo: true,
        inicioEn: new Date(),
        updatedByAdminId: "a",
      }),
    );
    assert.equal(mock.row, null);
  });

  it("P2025 en update se traduce a error de dominio (sin create)", async () => {
    // Fila vista en getConfig pero desaparece en update (carrera).
    let present = true;
    const client = {
      async $queryRaw() {
        return [];
      },
      vendedorCreditoCuenta: {} as never,
      creditoMovimiento: {} as never,
      creditosConfig: {
        async findUnique() {
          if (!present) return null;
          return {
            id: 1,
            controlActivo: false,
            inicioEn: null,
            umbralSaldoBajo: null,
            updatedAt: new Date(0),
            updatedByAdminId: null,
          };
        },
        async create() {
          throw new Error("create prohibido");
        },
        async upsert() {
          throw new Error("upsert prohibido");
        },
        async update() {
          present = false;
          throw new Prisma.PrismaClientKnownRequestError("not found", {
            code: "P2025",
            clientVersion: "5.22.0",
          });
        },
      },
    };
    const store = createPrismaCreditosStore(client as never, {
      alreadyInTransaction: true,
    });
    await assert.rejects(
      () => store.saveConfig({ updatedByAdminId: "a" }),
      (e: unknown) =>
        e instanceof CreditoConfigError &&
        e.code === "CREDITOS_CONFIG_NO_INICIALIZADA",
    );
  });
});

describe("admin flow con store memoria (saveConfig persistido)", () => {
  it("operaciones normales de administración siguen funcionando", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      umbralSaldoBajo: "10.00",
      updatedByAdminId: "admin",
    });
    const r = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "25.00",
      actorAdminId: "admin",
      idempotencyKey: "k-admin-ok",
    });
    assert.equal(r.cuenta.saldoDisponible.toFixed(2), "25.00");
    const cfg = await store.getConfig();
    assert.equal(cfg.configPersisted, true);
    assert.equal(cfg.umbralSaldoBajo?.toFixed(2), "10.00");
  });
});
