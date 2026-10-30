import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  actualizarCreditosConfig,
  getCreditosConfig,
} from "@/lib/creditos/config";
import { cuentaCoherenteConLibro } from "@/lib/creditos/control";
import {
  InsufficientCreditoSaldoError,
  CreditoIdempotencyConflictError,
  CreditoValidationError,
  CreditoVendedorRequeridoError,
  CreditoConfigError,
} from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
  consumirCreditosPorVenta,
  devolverCreditosPorAnulacion,
  ensureVendedorCreditoCuenta,
  registrarCorreccionCredito,
  retirarCreditos,
} from "@/lib/creditos/operaciones";
import { createMemoryCreditosStore } from "@/lib/creditos/store";

describe("cuentas y asignaciones", () => {
  it("crea cuenta con saldo 0 y consulta", async () => {
    const store = createMemoryCreditosStore();
    const cuenta = await ensureVendedorCreditoCuenta(store, "vend-1");
    assert.equal(cuenta.vendedorId, "vend-1");
    assert.equal(cuenta.saldoDisponible.toFixed(2), "0.00");
    const { cuenta: c2, movimientos } = await consultarSaldoYHistorial(
      store,
      "vend-1",
    );
    assert.equal(c2?.saldoDisponible.toFixed(2), "0.00");
    assert.equal(movimientos.length, 0);
  });

  it("asigna créditos sumando al saldo existente", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10.00",
      actorAdminId: "admin-1",
    });
    const r = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "5.50",
      actorAdminId: "admin-1",
      motivo: "recarga",
    });
    assert.equal(r.cuenta.saldoDisponible.toFixed(2), "15.50");
    assert.equal(r.movimiento.tipo, "ASIGNACION");
    assert.equal(r.movimiento.saldoAnterior.toFixed(2), "10.00");
    assert.equal(r.movimiento.saldoPosterior.toFixed(2), "15.50");
  });

  it("retira cantidad válida y rechaza retiro superior al saldo", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "20",
      actorAdminId: "admin-1",
    });
    const ok = await retirarCreditos(store, {
      vendedorId: "vend-1",
      importe: "7.25",
      actorAdminId: "admin-1",
    });
    assert.equal(ok.cuenta.saldoDisponible.toFixed(2), "12.75");

    await assert.rejects(
      () =>
        retirarCreditos(store, {
          vendedorId: "vend-1",
          importe: "12.76",
          actorAdminId: "admin-1",
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
    const { cuenta } = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "12.75");
  });

  it("decimales exactos (sin float)", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "0.10",
      actorAdminId: "admin-1",
    });
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "0.20",
      actorAdminId: "admin-1",
    });
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      store,
      "vend-1",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "0.30");
    assert.equal(
      cuentaCoherenteConLibro(cuenta!.saldoDisponible, movimientos),
      true,
    );
  });

  it("rechaza vendedorId vacío (no inventa propietario)", async () => {
    const store = createMemoryCreditosStore();
    await assert.rejects(
      () =>
        asignarCreditos(store, {
          vendedorId: "  ",
          importe: "1",
          actorAdminId: "admin-1",
        }),
      (e: unknown) => e instanceof CreditoVendedorRequeridoError,
    );
  });
});

describe("correcciones e historial inmutable", () => {
  it("registra corrección sin borrar el movimiento original", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "50",
      actorAdminId: "admin-1",
    });
    const corr = await registrarCorreccionCredito(store, {
      vendedorId: "vend-1",
      importe: "5",
      efecto: "DISMINUIR",
      actorAdminId: "admin-1",
      movimientoOrigenId: a.movimiento.id,
      motivo: "ajuste",
    });
    assert.equal(corr.movimiento.tipo, "CORRECCION");
    assert.equal(corr.movimiento.movimientoOrigenId, a.movimiento.id);
    assert.equal(corr.cuenta.saldoDisponible.toFixed(2), "45.00");

    const { movimientos } = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(movimientos.length, 2);
    assert.equal(movimientos[0]!.id, a.movimiento.id);
    assert.equal(movimientos[0]!.importe.toFixed(2), "50.00");
  });

  it("permite corrección sobre RETIRO", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "40",
      actorAdminId: "admin-1",
    });
    const retiro = await retirarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10",
      actorAdminId: "admin-1",
    });
    const corr = await registrarCorreccionCredito(store, {
      vendedorId: "vend-1",
      importe: "3",
      efecto: "AUMENTAR",
      actorAdminId: "admin-1",
      movimientoOrigenId: retiro.movimiento.id,
      motivo: "retiro parcial revertido",
    });
    assert.equal(corr.movimiento.tipo, "CORRECCION");
    assert.equal(corr.cuenta.saldoDisponible.toFixed(2), "33.00");
  });

  it("rechaza corrección sobre CONSUMO_VENTA sin mutar saldo ni libro", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "50",
      actorAdminId: "admin-1",
    });
    const consumo = await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-corr-consumo",
      importe: "12",
    });
    const before = await consultarSaldoYHistorial(store, "vend-1");
    await assert.rejects(
      () =>
        registrarCorreccionCredito(store, {
          vendedorId: "vend-1",
          importe: "12",
          efecto: "AUMENTAR",
          actorAdminId: "admin-1",
          movimientoOrigenId: consumo.movimiento.id,
          idempotencyKey: "11111111-1111-4111-8111-111111111101",
        }),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_ORIGEN_NO_CORREGIBLE",
    );
    const after = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(
      after.cuenta?.saldoDisponible.toFixed(2),
      before.cuenta?.saldoDisponible.toFixed(2),
    );
    assert.equal(after.movimientos.length, before.movimientos.length);
    assert.equal(
      after.movimientos.filter((m) => m.tipo === "CORRECCION").length,
      0,
    );
  });

  it("rechaza corrección sobre DEVOLUCION_ANULACION sin mutar saldo ni libro", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "40",
      actorAdminId: "admin-1",
    });
    await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-corr-dev",
      importe: "15",
    });
    const dev = await devolverCreditosPorAnulacion(store, {
      ticketId: "t-corr-dev",
      actorAdminId: "admin-1",
    });
    assert.ok(dev.movimiento);
    const before = await consultarSaldoYHistorial(store, "vend-1");
    await assert.rejects(
      () =>
        registrarCorreccionCredito(store, {
          vendedorId: "vend-1",
          importe: "5",
          efecto: "DISMINUIR",
          actorAdminId: "admin-1",
          movimientoOrigenId: dev.movimiento!.id,
        }),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_ORIGEN_NO_CORREGIBLE",
    );
    const after = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(after.cuenta?.saldoDisponible.toFixed(2), "40.00");
    assert.equal(after.movimientos.length, before.movimientos.length);
  });

  it("tras rechazo sobre CONSUMO, la devolución por anulación sigue íntegra", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "30",
      actorAdminId: "admin-1",
    });
    const consumo = await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-corr-then-dev",
      importe: "10",
    });
    await assert.rejects(() =>
      registrarCorreccionCredito(store, {
        vendedorId: "vend-1",
        importe: "10",
        efecto: "AUMENTAR",
        actorAdminId: "admin-1",
        movimientoOrigenId: consumo.movimiento.id,
      }),
    );
    const d = await devolverCreditosPorAnulacion(store, {
      ticketId: "t-corr-then-dev",
      actorAdminId: "admin-1",
    });
    assert.equal(d.skippedSinConsumo, false);
    assert.equal(d.cuenta?.saldoDisponible.toFixed(2), "30.00");
    assert.equal(d.movimiento?.tipo, "DEVOLUCION_ANULACION");
  });

  it("idempotencia de corrección válida: misma key → replay sin duplicar", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "20",
      actorAdminId: "admin-1",
    });
    const key = "22222222-2222-4222-8222-222222222201";
    const c1 = await registrarCorreccionCredito(store, {
      vendedorId: "vend-1",
      importe: "2",
      efecto: "AUMENTAR",
      actorAdminId: "admin-1",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: key,
    });
    const c2 = await registrarCorreccionCredito(store, {
      vendedorId: "vend-1",
      importe: "2",
      efecto: "AUMENTAR",
      actorAdminId: "admin-1",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: key,
    });
    assert.equal(c1.movimiento.id, c2.movimiento.id);
    assert.equal(c2.cuenta.saldoDisponible.toFixed(2), "22.00");
    const { movimientos } = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(movimientos.filter((m) => m.tipo === "CORRECCION").length, 1);
  });

  it("corrección que dejaría saldo negativo se rechaza", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "3",
      actorAdminId: "admin-1",
    });
    await assert.rejects(
      () =>
        registrarCorreccionCredito(store, {
          vendedorId: "vend-1",
          importe: "4",
          efecto: "DISMINUIR",
          actorAdminId: "admin-1",
          movimientoOrigenId: a.movimiento.id,
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
  });
});

describe("config y control desactivado por defecto", () => {
  it("default: controlActivo false e inicioEn null", async () => {
    const store = createMemoryCreditosStore();
    const c = await getCreditosConfig(store);
    assert.equal(c.controlActivo, false);
    assert.equal(c.inicioEn, null);
    assert.equal(c.umbralSaldoBajo, null);
  });

  it("permite preparar saldos con control desactivado", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "100",
      actorAdminId: "admin-1",
    });
    const c = await getCreditosConfig(store);
    assert.equal(c.controlActivo, false);
    const { cuenta } = await consultarSaldoYHistorial(store, "vend-1");
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "100.00");
  });

  it("no activa control sin inicioEn", async () => {
    const store = createMemoryCreditosStore();
    await assert.rejects(
      () =>
        actualizarCreditosConfig(store, {
          controlActivo: true,
          updatedByAdminId: "admin-1",
        }),
      (e: unknown) => e instanceof CreditoConfigError,
    );
  });

  it("guarda umbral de saldo bajo", async () => {
    const store = createMemoryCreditosStore();
    const c = await actualizarCreditosConfig(store, {
      umbralSaldoBajo: "25.00",
      updatedByAdminId: "admin-1",
    });
    assert.equal(c.umbralSaldoBajo?.toFixed(2), "25.00");
  });
});

describe("idempotencia administrativa", () => {
  it("misma idempotencyKey + mismos datos → replay", async () => {
    const store = createMemoryCreditosStore();
    const a1 = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10",
      actorAdminId: "admin-1",
      idempotencyKey: "idem-a",
    });
    const a2 = await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10",
      actorAdminId: "admin-1",
      idempotencyKey: "idem-a",
    });
    assert.equal(a1.movimiento.id, a2.movimiento.id);
    assert.equal(a2.cuenta.saldoDisponible.toFixed(2), "10.00");
  });

  it("misma key con importe distinto → conflicto", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10",
      actorAdminId: "admin-1",
      idempotencyKey: "idem-b",
    });
    await assert.rejects(
      () =>
        asignarCreditos(store, {
          vendedorId: "vend-1",
          importe: "11",
          actorAdminId: "admin-1",
          idempotencyKey: "idem-b",
        }),
      (e: unknown) => e instanceof CreditoIdempotencyConflictError,
    );
  });
});

describe("consumo y devolución (dominio, no cableado a tickets)", () => {
  it("consume total y no duplica por el mismo ticket", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "100",
      actorAdminId: "admin-1",
    });
    const c1 = await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-1",
      importe: new Prisma.Decimal("12.50"),
    });
    assert.equal(c1.cuenta.saldoDisponible.toFixed(2), "87.50");
    const c2 = await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-1",
      importe: "12.50",
    });
    assert.equal(c1.movimiento.id, c2.movimiento.id);
    assert.equal(c2.cuenta.saldoDisponible.toFixed(2), "87.50");
  });

  it("rechaza consumo con saldo insuficiente", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "5",
      actorAdminId: "admin-1",
    });
    await assert.rejects(
      () =>
        consumirCreditosPorVenta(store, {
          vendedorId: "vend-1",
          ticketId: "t-2",
          importe: "5.01",
        }),
      (e: unknown) => e instanceof InsufficientCreditoSaldoError,
    );
  });

  it("devolución idempotente y sin inventar consumo", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "40",
      actorAdminId: "admin-1",
    });
    await consumirCreditosPorVenta(store, {
      vendedorId: "vend-1",
      ticketId: "t-3",
      importe: "15",
    });
    const d1 = await devolverCreditosPorAnulacion(store, {
      ticketId: "t-3",
      actorAdminId: "admin-1",
    });
    assert.equal(d1.skippedSinConsumo, false);
    assert.equal(d1.cuenta?.saldoDisponible.toFixed(2), "40.00");
    assert.equal(d1.movimiento?.tipo, "DEVOLUCION_ANULACION");
    assert.ok(d1.movimiento?.movimientoOrigenId);

    const d2 = await devolverCreditosPorAnulacion(store, { ticketId: "t-3" });
    assert.equal(d1.movimiento?.id, d2.movimiento?.id);
    assert.equal(d2.cuenta?.saldoDisponible.toFixed(2), "40.00");

    const skip = await devolverCreditosPorAnulacion(store, {
      ticketId: "t-sin-consumo",
    });
    assert.equal(skip.skippedSinConsumo, true);
    assert.equal(skip.movimiento, null);
  });

  it("concurrencia: dos consumos paralelos no dejan saldo negativo", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "vend-1",
      importe: "10",
      actorAdminId: "admin-1",
    });
    const results = await Promise.allSettled([
      consumirCreditosPorVenta(store, {
        vendedorId: "vend-1",
        ticketId: "t-a",
        importe: "7",
      }),
      consumirCreditosPorVenta(store, {
        vendedorId: "vend-1",
        ticketId: "t-b",
        importe: "7",
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]!.status === "rejected" &&
        rejected[0].reason instanceof InsufficientCreditoSaldoError,
    );
    const { cuenta, movimientos } = await consultarSaldoYHistorial(
      store,
      "vend-1",
    );
    assert.equal(cuenta?.saldoDisponible.toFixed(2), "3.00");
    assert.ok(cuenta!.saldoDisponible.gte(0));
    assert.equal(
      cuentaCoherenteConLibro(cuenta!.saldoDisponible, movimientos),
      true,
    );
  });
});
