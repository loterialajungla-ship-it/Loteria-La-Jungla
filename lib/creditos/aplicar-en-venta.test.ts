import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { consumirCreditosTrasEmitirTicket } from "@/lib/creditos/aplicar-en-venta";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import {
  CreditosConfigIncompleteError,
  CreditosSchemaUnavailableError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
} from "@/lib/creditos/operaciones";
import {
  createMemoryCreditosStore,
  type CreditosStore,
} from "@/lib/creditos/store";

const INICIO = new Date("2026-11-01T04:00:00.000Z");

function schemaMissingPrismaError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'The table `public.CreditosConfig` does not exist in the current database.',
    {
      code: "P2021",
      clientVersion: "5.22.0",
      meta: { table: "CreditosConfig" },
    },
  );
}

function storeWithSchemaMissingOnConfig(base: CreditosStore): CreditosStore {
  return {
    ...base,
    async getConfig() {
      throw schemaMissingPrismaError();
    },
  };
}

function storeWithUnpersistedConfig(base: CreditosStore): CreditosStore {
  return {
    ...base,
    async getConfig() {
      const c = await base.getConfig();
      return { ...c, configPersisted: false, controlActivo: false, inicioEn: null };
    },
  };
}

function storeSchemaMissingOnConsume(base: CreditosStore): CreditosStore {
  // runInTransaction del memory store pasa el api original; hay que fallar en la TX.
  return {
    ...base,
    async runInTransaction() {
      throw schemaMissingPrismaError();
    },
  };
}

describe("consumirCreditosTrasEmitirTicket", () => {
  it("control desactivado → skipped sin tocar saldo", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "50",
      actorAdminId: "a1",
    });
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t1",
      ticketCreatedAt: new Date("2026-12-01T00:00:00.000Z"),
      totalApostado: "10",
    });
    assert.equal(r.status, "skipped");
    const { cuenta, movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "50.00");
    assert.equal(movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length, 0);
  });

  it("inicioEn null con controlActivo true → no consume (config rechaza activar; snapshot null)", async () => {
    const store = createMemoryCreditosStore();
    // No se puede activar sin inicio; snapshot queda inactivo por defecto.
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t1",
      ticketCreatedAt: new Date(),
      totalApostado: "1",
    });
    assert.equal(r.status, "skipped");
  });

  it("ADMIN exento aunque control activo y createdAt posterior", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "50",
      actorAdminId: "a1",
    });
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "ADMIN",
      vendedorId: "v1",
      ticketId: "t-admin",
      ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
      totalApostado: "20",
    });
    assert.equal(r.status, "skipped");
    const { cuenta } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "50.00");
  });

  it("antes / exactamente en / después del corte", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "100",
      actorAdminId: "a1",
    });

    const before = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t-before",
      ticketCreatedAt: new Date(INICIO.getTime() - 1),
      totalApostado: "5",
    });
    assert.equal(before.status, "skipped");

    const exact = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t-exact",
      ticketCreatedAt: new Date(INICIO),
      totalApostado: "5.00",
    });
    assert.equal(exact.status, "consumed");

    const after = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t-after",
      ticketCreatedAt: new Date(INICIO.getTime() + 1),
      totalApostado: new Prisma.Decimal("7.50"),
    });
    assert.equal(after.status, "consumed");

    const { cuenta } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "87.50");
  });

  it("vendedorId null → skipped (no inventa propietario)", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: null,
      ticketId: "t-hist",
      ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
      totalApostado: "3",
    });
    assert.equal(r.status, "skipped");
  });

  it("saldo insuficiente → lanza y no deja CONSUMO", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "2",
      actorAdminId: "a1",
    });
    await assert.rejects(
      () =>
        consumirCreditosTrasEmitirTicket(store, {
          actorRol: "VENDEDOR",
          vendedorId: "v1",
          ticketId: "t-insuf",
          ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
          totalApostado: "2.01",
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
    const { movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length, 0);
  });

  it("no usa fechaJuego: createdAt antiguo no consume aunque fechaJuego sea futura", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "a1",
    });
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "VENDEDOR",
      vendedorId: "v1",
      ticketId: "t-fj",
      ticketCreatedAt: new Date("2026-10-01T00:00:00.000Z"),
      totalApostado: "4",
    });
    assert.equal(r.status, "skipped");
  });

  it("esquema ausente al leer config → CreditosSchemaUnavailableError (fail-closed)", async () => {
    const base = createMemoryCreditosStore();
    const store = storeWithSchemaMissingOnConfig(base);
    await assert.rejects(
      () =>
        consumirCreditosTrasEmitirTicket(store, {
          actorRol: "VENDEDOR",
          vendedorId: "v1",
          ticketId: "t-schema",
          ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
          totalApostado: "1",
        }),
      (e: unknown) => e instanceof CreditosSchemaUnavailableError,
    );
    const { movimientos } = await consultarSaldoYHistorial(base, "v1");
    assert.equal(movimientos.length, 0);
  });

  it("esquema ausente al consumir (control activo) → no éxito silencioso", async () => {
    const base = createMemoryCreditosStore();
    await actualizarCreditosConfig(base, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    await asignarCreditos(base, {
      vendedorId: "v1",
      importe: "50",
      actorAdminId: "a1",
    });
    const store = storeSchemaMissingOnConsume(base);
    await assert.rejects(
      () =>
        consumirCreditosTrasEmitirTicket(store, {
          actorRol: "VENDEDOR",
          vendedorId: "v1",
          ticketId: "t-schema-consume",
          ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
          totalApostado: "10",
        }),
      (e: unknown) => e instanceof CreditosSchemaUnavailableError,
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(base, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "50.00");
    assert.equal(movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length, 0);
  });

  it("config no persistida ≠ control off → CreditosConfigIncompleteError", async () => {
    const base = createMemoryCreditosStore();
    const store = storeWithUnpersistedConfig(base);
    await assert.rejects(
      () =>
        consumirCreditosTrasEmitirTicket(store, {
          actorRol: "VENDEDOR",
          vendedorId: "v1",
          ticketId: "t-nopersist",
          ticketCreatedAt: new Date(),
          totalApostado: "1",
        }),
      (e: unknown) => e instanceof CreditosConfigIncompleteError,
    );
  });

  it("ADMIN exento aunque getConfig falle por esquema ausente", async () => {
    const store = storeWithSchemaMissingOnConfig(createMemoryCreditosStore());
    const r = await consumirCreditosTrasEmitirTicket(store, {
      actorRol: "ADMIN",
      vendedorId: "v1",
      ticketId: "t-admin-schema",
      ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
      totalApostado: "99",
    });
    assert.equal(r.status, "skipped");
  });

  it("error inesperado de DB no se convierte en skipped ni en saldo insuficiente", async () => {
    const base = createMemoryCreditosStore();
    await actualizarCreditosConfig(base, {
      controlActivo: true,
      inicioEn: INICIO,
      updatedByAdminId: "a1",
    });
    const store: CreditosStore = {
      ...base,
      async getConfig() {
        throw new Error("connection reset by peer");
      },
    };
    await assert.rejects(
      () =>
        consumirCreditosTrasEmitirTicket(store, {
          actorRol: "VENDEDOR",
          vendedorId: "v1",
          ticketId: "t-boom",
          ticketCreatedAt: new Date("2026-11-02T00:00:00.000Z"),
          totalApostado: "1",
        }),
      (e: unknown) =>
        e instanceof Error &&
        e.message === "connection reset by peer" &&
        !(e instanceof InsufficientCreditoSaldoError) &&
        !(e instanceof CreditosSchemaUnavailableError),
    );
  });
});
