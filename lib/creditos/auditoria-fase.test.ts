/**
 * Pruebas añadidas en la auditoría 1.1 (defectos / lagunas).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  CreditoIdempotencyConflictError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consumirCreditosPorVenta,
  consultarSaldoYHistorial,
  devolverCreditosPorAnulacion,
  registrarCorreccionCredito,
  retirarCreditos,
} from "@/lib/creditos/operaciones";
import {
  cuentaCoherenteConLibro,
  movimientoSaldosCoherentesConTipo,
} from "@/lib/creditos/control";
import {
  createMemoryCreditosStore,
  type CreditosStore,
  type NuevoCreditoMovimiento,
} from "@/lib/creditos/store";

describe("auditoría 1.1 — saldos coherentes con tipo", () => {
  it("ASIGNACION / RETIRO / CONSUMO / DEVOLUCION / CORRECCION", () => {
    assert.equal(
      movimientoSaldosCoherentesConTipo({
        tipo: "ASIGNACION",
        importe: new Prisma.Decimal("10"),
        saldoAnterior: new Prisma.Decimal("0"),
        saldoPosterior: new Prisma.Decimal("10"),
      }),
      true,
    );
    assert.equal(
      movimientoSaldosCoherentesConTipo({
        tipo: "RETIRO",
        importe: new Prisma.Decimal("3"),
        saldoAnterior: new Prisma.Decimal("10"),
        saldoPosterior: new Prisma.Decimal("7"),
      }),
      true,
    );
    assert.equal(
      movimientoSaldosCoherentesConTipo({
        tipo: "ASIGNACION",
        importe: new Prisma.Decimal("10"),
        saldoAnterior: new Prisma.Decimal("0"),
        saldoPosterior: new Prisma.Decimal("9"),
      }),
      false,
    );
    assert.equal(
      movimientoSaldosCoherentesConTipo({
        tipo: "CORRECCION",
        importe: new Prisma.Decimal("2"),
        saldoAnterior: new Prisma.Decimal("5"),
        saldoPosterior: new Prisma.Decimal("3"),
      }),
      true,
    );
  });
});

describe("auditoría 1.1 — idempotencia admin y correcciones", () => {
  it("retiro: misma key → replay sin segundo movimiento", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "50",
      actorAdminId: "a1",
    });
    const r1 = await retirarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "a1",
      idempotencyKey: "ret-1",
    });
    const r2 = await retirarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "a1",
      idempotencyKey: "ret-1",
    });
    assert.equal(r1.movimiento.id, r2.movimiento.id);
    assert.equal(r2.cuenta.saldoDisponible.toFixed(2), "40.00");
    const { movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(movimientos.filter((m) => m.tipo === "RETIRO").length, 1);
  });

  it("corrección: misma key con efecto opuesto → conflicto", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "20",
      actorAdminId: "a1",
    });
    await registrarCorreccionCredito(store, {
      vendedorId: "v1",
      importe: "5",
      efecto: "DISMINUIR",
      actorAdminId: "a1",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: "corr-1",
    });
    await assert.rejects(
      () =>
        registrarCorreccionCredito(store, {
          vendedorId: "v1",
          importe: "5",
          efecto: "AUMENTAR",
          actorAdminId: "a1",
          movimientoOrigenId: a.movimiento.id,
          idempotencyKey: "corr-1",
        }),
      (e: unknown) => e instanceof CreditoIdempotencyConflictError,
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "15.00");
    assert.equal(movimientos.filter((m) => m.tipo === "CORRECCION").length, 1);
  });
});

describe("auditoría 1.1 — compensación si UNIQUE tras ajustar saldo", () => {
  it("ajustarEInsertarMovimiento revierte el delta y reutiliza el movimiento ganador", async () => {
    const { ajustarEInsertarMovimiento } = await import(
      "@/lib/creditos/tx-helpers"
    );
    const store = createMemoryCreditosStore();
    await store.ensureCuenta("v1");
    // Otro worker ya aplicó +10 y persistió el movimiento con la misma key.
    await store.ajustarSaldoAtomico({
      vendedorId: "v1",
      delta: new Prisma.Decimal("10"),
    });
    await store.insertMovimiento({
      id: "cm_ganador",
      vendedorId: "v1",
      tipo: "ASIGNACION",
      importe: new Prisma.Decimal("10"),
      saldoAnterior: new Prisma.Decimal("0"),
      saldoPosterior: new Prisma.Decimal("10"),
      actorAdminId: "a1",
      idempotencyKey: "asig-race",
    });

    const wrapped: CreditosStore = {
      ...store,
      insertMovimiento: async (mov: NuevoCreditoMovimiento) => {
        if (mov.idempotencyKey === "asig-race") {
          const err = new Error("UNIQUE");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        return store.insertMovimiento(mov);
      },
    };

    const mov = await ajustarEInsertarMovimiento(wrapped, {
      vendedorId: "v1",
      delta: new Prisma.Decimal("10"),
      ahora: new Date(),
      buildMovimiento: (saldos) => ({
        id: "cm_perdedor",
        vendedorId: "v1",
        tipo: "ASIGNACION",
        importe: new Prisma.Decimal("10"),
        ...saldos,
        actorAdminId: "a1",
        idempotencyKey: "asig-race",
      }),
      onUnique: async () => {
        const existing = await store.findMovimientoByIdempotencyKey("asig-race");
        assert.ok(existing);
        return existing;
      },
    });

    assert.equal(mov.id, "cm_ganador");
    const cuenta = await store.getCuenta("v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "10.00");
    const movimientos = await store.listMovimientosByVendedor("v1");
    assert.equal(movimientos.length, 1);
    assert.equal(
      cuentaCoherenteConLibro(cuenta!.saldoDisponible, movimientos),
      true,
    );
  });
});

describe("auditoría 1.1 — devolución duplicada y límites", () => {
  it("segunda devolución no crea segundo movimiento ni altera saldo", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "30",
      actorAdminId: "a1",
    });
    await consumirCreditosPorVenta(store, {
      vendedorId: "v1",
      ticketId: "tk-dup",
      importe: "12",
    });
    const d1 = await devolverCreditosPorAnulacion(store, {
      ticketId: "tk-dup",
      actorAdminId: "a1",
    });
    const d2 = await devolverCreditosPorAnulacion(store, {
      ticketId: "tk-dup",
      actorAdminId: "a1",
    });
    assert.equal(d1.movimiento?.id, d2.movimiento?.id);
    assert.equal(d2.cuenta?.saldoDisponible.toFixed(2), "30.00");
    const { movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(
      movimientos.filter((m) => m.tipo === "DEVOLUCION_ANULACION").length,
      1,
    );
  });

  it("consumo insuficiente: historial sin CONSUMO y saldo intacto", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "1.00",
      actorAdminId: "a1",
    });
    await assert.rejects(
      () =>
        consumirCreditosPorVenta(store, {
          vendedorId: "v1",
          ticketId: "tk-x",
          importe: "1.01",
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "1.00");
    assert.equal(
      movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
      0,
    );
  });
});

describe("auditoría 1.1 — límite de la tienda en memoria vs Postgres", () => {
  it("documenta: la serialización en memoria no sustituye FOR UPDATE / UPDATE condicional", () => {
    // Este test existe para dejar constancia en CI de la limitación.
    // createMemoryCreditosStore encadena runInTransaction; Postgres exige
    // UPDATE … WHERE saldo+delta>=0 RETURNING (o SELECT FOR UPDATE) en el adaptador.
    assert.equal(typeof createMemoryCreditosStore, "function");
  });
});
