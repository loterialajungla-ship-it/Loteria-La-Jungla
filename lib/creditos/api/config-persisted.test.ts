import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { serializeConfig } from "@/lib/creditos/api/serialize";
import { actualizarCreditosConfig, getCreditosConfig } from "@/lib/creditos/config";
import { CreditoConfigError } from "@/lib/creditos/errors";
import { createMemoryCreditosStore } from "@/lib/creditos/store";
import type { CreditosStore } from "@/lib/creditos/store";
import type { CreditosConfigView } from "@/lib/creditos/types";

function unpersistedStore(base: CreditosStore): CreditosStore {
  const wrap = (inner: CreditosStore): CreditosStore => ({
    ...inner,
    async runInTransaction(fn) {
      return inner.runInTransaction((tx) => fn(wrap(tx)));
    },
    async getConfig() {
      const c = await inner.getConfig();
      return {
        ...c,
        configPersisted: false,
        controlActivo: false,
        inicioEn: null,
      };
    },
  });
  return wrap(base);
}

describe("API configPersisted", () => {
  it("configuración ausente → configPersisted=false", async () => {
    const store = unpersistedStore(createMemoryCreditosStore());
    const c = await getCreditosConfig(store);
    assert.equal(c.configPersisted, false);
    const pub = serializeConfig(c);
    assert.equal(pub.configPersisted, false);
    assert.equal(pub.controlActivo, false);
  });

  it("configuración existente apagada → true/false", async () => {
    const store = createMemoryCreditosStore();
    const c = await getCreditosConfig(store);
    assert.equal(c.configPersisted, true);
    assert.equal(c.controlActivo, false);
    const pub = serializeConfig(c);
    assert.equal(pub.configPersisted, true);
    assert.equal(pub.controlActivo, false);
  });

  it("configuración activa → true/true", async () => {
    const store = createMemoryCreditosStore();
    const c = await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: new Date("2026-11-01T04:00:00.000Z"),
      updatedByAdminId: "admin",
    });
    const pub = serializeConfig(c);
    assert.equal(pub.configPersisted, true);
    assert.equal(pub.controlActivo, true);
    assert.ok(pub.inicioEn);
  });

  it("error de infraestructura no se transforma en defaults", async () => {
    const store: CreditosStore = {
      ...createMemoryCreditosStore(),
      async getConfig() {
        throw new Error("ECONNREFUSED simulated");
      },
    };
    await assert.rejects(
      () => getCreditosConfig(store),
      (e: unknown) =>
        e instanceof Error && e.message === "ECONNREFUSED simulated",
    );
  });

  it("PATCH rechazado si config no persistida (sin bootstrap lazy)", async () => {
    const store = unpersistedStore(createMemoryCreditosStore());
    await assert.rejects(
      () =>
        actualizarCreditosConfig(store, {
          umbralSaldoBajo: "1.00",
          updatedByAdminId: "admin",
        }),
      (e: unknown) =>
        e instanceof CreditoConfigError &&
        e.code === "CREDITOS_CONFIG_NO_INICIALIZADA",
    );
  });

  it("serialize incluye configPersisted en vista virtual y persistida", () => {
    const virtual: CreditosConfigView = {
      configPersisted: false,
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: null,
      updatedAt: new Date(0),
      updatedByAdminId: null,
    };
    assert.equal(serializeConfig(virtual).configPersisted, false);

    const persisted: CreditosConfigView = {
      configPersisted: true,
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: new Prisma.Decimal("5.00"),
      updatedAt: new Date("2026-10-30T00:00:00.000Z"),
      updatedByAdminId: "a1",
    };
    const pub = serializeConfig(persisted);
    assert.equal(pub.configPersisted, true);
    assert.equal(pub.umbralSaldoBajo, "5.00");
  });
});
