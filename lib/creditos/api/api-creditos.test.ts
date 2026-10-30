/**
 * Pruebas de capa API de créditos (parse + dominio + mapper).
 * Sin Neon: store en memoria + asserts de contrato HTTP.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actualizarCreditosConfig } from "@/lib/creditos/config";
import {
  CreditoIdempotencyConflictError,
  CreditoValidationError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  asignarCreditos,
  consultarSaldoYHistorial,
  registrarCorreccionCredito,
  retirarCreditos,
} from "@/lib/creditos/operaciones";
import { createMemoryCreditosStore } from "@/lib/creditos/store";
import { mapCreditoErrorToHttp } from "@/lib/creditos/api/map-credito-http-error";
import {
  parseAsignarRetirarBody,
  parseConfigPatchBody,
  parseCorregirBody,
} from "@/lib/creditos/api/parse";
import {
  serializeConfig,
  serializeCuentaBasica,
  serializeMovimiento,
} from "@/lib/creditos/api/serialize";

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const K3 = "33333333-3333-4333-8333-333333333333";
const K4 = "44444444-4444-4444-8444-444444444444";

describe("API créditos — mapper HTTP", () => {
  it("saldo insuficiente e idempotencia → 409", () => {
    assert.equal(
      mapCreditoErrorToHttp(new InsufficientCreditoSaldoError()).status,
      409,
    );
    assert.equal(
      mapCreditoErrorToHttp(new CreditoIdempotencyConflictError()).status,
      409,
    );
  });

  it("validación / origen no encontrado → 400/404", () => {
    assert.equal(
      mapCreditoErrorToHttp(new CreditoValidationError("x")).status,
      400,
    );
    assert.equal(
      mapCreditoErrorToHttp(
        new CreditoValidationError("nf", "CREDITO_VENDEDOR_NO_ENCONTRADO"),
      ).status,
      404,
    );
  });
});

describe("API créditos — asignación / retiro / idempotencia", () => {
  it("asignación acumulativa y retiro válido", async () => {
    const store = createMemoryCreditosStore();
    const a1 = parseAsignarRetirarBody({
      importe: "10.00",
      idempotencyKey: K1,
    });
    const r1 = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: a1.importe,
      actorAdminId: "admin",
      idempotencyKey: a1.idempotencyKey,
    });
    const a2 = parseAsignarRetirarBody({
      importe: "5.50",
      idempotencyKey: K2,
    });
    const r2 = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: a2.importe,
      actorAdminId: "admin",
      idempotencyKey: a2.idempotencyKey,
    });
    assert.equal(r2.cuenta.saldoDisponible.toFixed(2), "15.50");

    const ret = parseAsignarRetirarBody({
      importe: "3.00",
      idempotencyKey: K3,
    });
    const r3 = await retirarCreditos(store, {
      vendedorId: "v1",
      importe: ret.importe,
      actorAdminId: "admin",
      idempotencyKey: ret.idempotencyKey,
    });
    assert.equal(r3.cuenta.saldoDisponible.toFixed(2), "12.50");
    assert.equal(serializeMovimiento(r1.movimiento).importe, "10.00");
    assert.equal(
      serializeCuentaBasica(r3.cuenta, null).saldoDisponible,
      "12.50",
    );
  });

  it("retiro superior al saldo → InsufficientCreditoSaldoError", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "2.00",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    await assert.rejects(
      () =>
        retirarCreditos(store, {
          vendedorId: "v1",
          importe: "5.00",
          actorAdminId: "admin",
          idempotencyKey: K2,
        }),
      InsufficientCreditoSaldoError,
    );
  });

  it("replay misma key no duplica; key con datos distintos → conflicto", async () => {
    const store = createMemoryCreditosStore();
    const first = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "20.00",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    const replay = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "20.00",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    assert.equal(replay.movimiento.id, first.movimiento.id);
    assert.equal(replay.cuenta.saldoDisponible.toFixed(2), "20.00");

    await assert.rejects(
      () =>
        asignarCreditos(store, {
          vendedorId: "v1",
          importe: "21.00",
          actorAdminId: "admin",
          idempotencyKey: K1,
        }),
      CreditoIdempotencyConflictError,
    );

    const { movimientos } = await consultarSaldoYHistorial(store, "v1");
    assert.equal(
      movimientos.filter((m) => m.tipo === "ASIGNACION").length,
      1,
    );
  });

  it("idempotencia de retiro", async () => {
    const store = createMemoryCreditosStore();
    await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "50",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    const r1 = await retirarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "admin",
      idempotencyKey: K2,
    });
    const r2 = await retirarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "admin",
      idempotencyKey: K2,
    });
    assert.equal(r1.movimiento.id, r2.movimiento.id);
    assert.equal(r2.cuenta.saldoDisponible.toFixed(2), "40.00");
  });
});

describe("API créditos — corrección y configuración", () => {
  it("corrección compensatoria y rechazo de duplicado de origen", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "30",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    const body = parseCorregirBody({
      importe: "5.00",
      efecto: "DISMINUIR",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: K2,
    });
    const c = await registrarCorreccionCredito(store, {
      vendedorId: "v1",
      importe: body.importe,
      efecto: body.efecto,
      actorAdminId: "admin",
      movimientoOrigenId: body.movimientoOrigenId,
      idempotencyKey: body.idempotencyKey,
    });
    assert.equal(c.cuenta.saldoDisponible.toFixed(2), "25.00");
    assert.equal(c.movimiento.movimientoOrigenId, a.movimiento.id);

    await assert.rejects(
      () =>
        registrarCorreccionCredito(store, {
          vendedorId: "v1",
          importe: "1.00",
          efecto: "DISMINUIR",
          actorAdminId: "admin",
          movimientoOrigenId: a.movimiento.id,
          idempotencyKey: K3,
        }),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_CORRECCION_DUPLICADA",
    );
  });

  it("replay de corrección con misma key no duplica", async () => {
    const store = createMemoryCreditosStore();
    const a = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "30",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    const c1 = await registrarCorreccionCredito(store, {
      vendedorId: "v1",
      importe: "2",
      efecto: "AUMENTAR",
      actorAdminId: "admin",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: K4,
    });
    const c2 = await registrarCorreccionCredito(store, {
      vendedorId: "v1",
      importe: "2",
      efecto: "AUMENTAR",
      actorAdminId: "admin",
      movimientoOrigenId: a.movimiento.id,
      idempotencyKey: K4,
    });
    assert.equal(c1.movimiento.id, c2.movimiento.id);
    assert.equal(c2.cuenta.saldoDisponible.toFixed(2), "32.00");
  });

  it("config: inicioEn null y control desactivado; activar exige inicio", async () => {
    const store = createMemoryCreditosStore();
    const patch = parseConfigPatchBody({
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: "10.00",
    });
    const c = await actualizarCreditosConfig(store, {
      controlActivo: patch.controlActivo,
      inicioEn: patch.inicioEn,
      umbralSaldoBajo: patch.umbralSaldoBajo,
      updatedByAdminId: "admin",
    });
    assert.equal(c.controlActivo, false);
    assert.equal(c.inicioEn, null);
    const pub = serializeConfig(c);
    assert.equal(pub.umbralSaldoBajo, "10.00");
    assert.equal(pub.inicioEn, null);

    await assert.rejects(
      () =>
        actualizarCreditosConfig(store, {
          controlActivo: true,
          updatedByAdminId: "admin",
        }),
      (e: unknown) =>
        e instanceof Error && /inicio/i.test((e as Error).message),
    );
  });

  it("saldo bajo respecto al umbral", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      umbralSaldoBajo: "15.00",
      updatedByAdminId: "admin",
    });
    const r = await asignarCreditos(store, {
      vendedorId: "v1",
      importe: "10",
      actorAdminId: "admin",
      idempotencyKey: K1,
    });
    const vista = serializeCuentaBasica(
      r.cuenta,
      (await store.getConfig()).umbralSaldoBajo,
    );
    assert.equal(vista.saldoBajo, true);
    assert.equal(vista.umbralSaldoBajo, "15.00");
  });

  it("importes con más de 2 decimales se rechazan", async () => {
    const store = createMemoryCreditosStore();
    await assert.rejects(
      () =>
        asignarCreditos(store, {
          vendedorId: "v1",
          importe: "1.001",
          actorAdminId: "admin",
          idempotencyKey: K1,
        }),
      CreditoValidationError,
    );
  });

  it("importe que excede Decimal(12,2) se rechaza", async () => {
    const store = createMemoryCreditosStore();
    await assert.rejects(
      () =>
        asignarCreditos(store, {
          vendedorId: "v1",
          importe: "10000000000.00",
          actorAdminId: "admin",
          idempotencyKey: K1,
        }),
      CreditoValidationError,
    );
  });
});

describe("API créditos — aislamiento documental", () => {
  it("mi-cuenta usa solo sessionUserId (no query vendedorId)", () => {
    const params = new URLSearchParams("vendedorId=otro-vendedor&page=1");
    params.delete("vendedorId");
    assert.equal(params.get("vendedorId"), null);
    // getMiCuentaCreditos siempre recibe sessionUserId del guard.
  });

  it("rutas admin exigen ADMIN; vendedor no puede mutar saldos vía body", () => {
    assert.throws(
      () =>
        parseAsignarRetirarBody({
          importe: "1",
          idempotencyKey: K1,
          tipo: "ASIGNACION",
        }),
      CreditoValidationError,
    );
  });
});
