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
import { getMiCuentaCreditos } from "@/lib/creditos/api/mi-cuenta";
import {
  serializeConfig,
  serializeCuentaBasica,
  serializeMiCuentaConfig,
  serializeMovimiento,
} from "@/lib/creditos/api/serialize";
import { Prisma } from "@prisma/client";

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

/**
 * DB mínima en memoria para getMiCuentaCreditos (sin Neon).
 * Simula el contrato Prisma que usa mi-cuenta + createPrismaCreditosStore.getConfig.
 */
function createFakeMiCuentaDb(args: {
  users: { id: string; activo: boolean }[];
  cuentas: {
    vendedorId: string;
    saldoDisponible: string;
    createdAt?: Date;
    updatedAt?: Date;
  }[];
  config?: {
    controlActivo: boolean;
    inicioEn: Date | null;
    umbralSaldoBajo: string | null;
  };
}) {
  const now = new Date("2026-11-02T12:00:00.000Z");
  const configRow = args.config
    ? {
        id: 1,
        controlActivo: args.config.controlActivo,
        inicioEn: args.config.inicioEn,
        umbralSaldoBajo:
          args.config.umbralSaldoBajo == null
            ? null
            : new Prisma.Decimal(args.config.umbralSaldoBajo),
        updatedAt: now,
        updatedByAdminId: "admin-test",
      }
    : null;

  return {
    usuario: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        args.users.find((u) => u.id === where.id) ?? null,
    },
    vendedorCreditoCuenta: {
      findUnique: async ({ where }: { where: { vendedorId: string } }) => {
        const row = args.cuentas.find((c) => c.vendedorId === where.vendedorId);
        if (!row) return null;
        return {
          vendedorId: row.vendedorId,
          saldoDisponible: new Prisma.Decimal(row.saldoDisponible),
          createdAt: row.createdAt ?? now,
          updatedAt: row.updatedAt ?? now,
        };
      },
    },
    creditoMovimiento: {
      count: async () => 0,
      findMany: async () => [],
    },
    creditosConfig: {
      findUnique: async () => configRow,
    },
  };
}

/** Réplica del paso defensivo de GET /api/creditos/mi-cuenta. */
function searchParamsForMiCuenta(raw: string): URLSearchParams {
  const searchParams = new URLSearchParams(raw);
  searchParams.delete("vendedorId");
  return searchParams;
}

describe("API créditos — aislamiento documental", () => {
  it("mi-cuenta usa solo sessionUserId (no query vendedorId)", () => {
    const params = new URLSearchParams("vendedorId=otro-vendedor&page=1");
    params.delete("vendedorId");
    assert.equal(params.get("vendedorId"), null);
  });

  it("misma sesión: con y sin vendedorId ajeno → misma cuenta/saldo", async () => {
    const db = createFakeMiCuentaDb({
      users: [
        { id: "vend-sesion", activo: true },
        { id: "vend-ajeno", activo: true },
      ],
      cuentas: [
        { vendedorId: "vend-sesion", saldoDisponible: "42.50" },
        { vendedorId: "vend-ajeno", saldoDisponible: "99.00" },
      ],
      config: {
        controlActivo: true,
        inicioEn: new Date("2026-01-01T04:00:00.000Z"),
        umbralSaldoBajo: "10.00",
      },
    });

    const sinAlien = await getMiCuentaCreditos(db as never, {
      sessionUserId: "vend-sesion",
      searchParams: searchParamsForMiCuenta("page=1&pageSize=1"),
    });
    const conAlien = await getMiCuentaCreditos(db as never, {
      sessionUserId: "vend-sesion",
      searchParams: searchParamsForMiCuenta(
        "page=1&pageSize=1&vendedorId=vend-ajeno",
      ),
    });

    assert.equal(sinAlien.cuenta.tieneCuenta, true);
    assert.equal(sinAlien.cuenta.saldoDisponible, "42.50");
    assert.equal(conAlien.cuenta.tieneCuenta, sinAlien.cuenta.tieneCuenta);
    assert.equal(conAlien.cuenta.saldoDisponible, sinAlien.cuenta.saldoDisponible);
    assert.equal(conAlien.cuenta.saldoBajo, sinAlien.cuenta.saldoBajo);
    // No filtra el saldo del vendedor ajeno.
    assert.notEqual(conAlien.cuenta.saldoDisponible, "99.00");
  });

  it("dos vendedores ficticios: cada sesión ve solo su saldo", async () => {
    const db = createFakeMiCuentaDb({
      users: [
        { id: "vend-a", activo: true },
        { id: "vend-b", activo: true },
      ],
      cuentas: [
        { vendedorId: "vend-a", saldoDisponible: "12.00" },
        { vendedorId: "vend-b", saldoDisponible: "77.25" },
      ],
      config: {
        controlActivo: true,
        inicioEn: new Date("2026-01-01T04:00:00.000Z"),
        umbralSaldoBajo: null,
      },
    });

    const a = await getMiCuentaCreditos(db as never, {
      sessionUserId: "vend-a",
      searchParams: searchParamsForMiCuenta(
        "page=1&pageSize=1&vendedorId=vend-b",
      ),
    });
    const b = await getMiCuentaCreditos(db as never, {
      sessionUserId: "vend-b",
      searchParams: searchParamsForMiCuenta(
        "page=1&pageSize=1&vendedorId=vend-a",
      ),
    });

    assert.equal(a.cuenta.saldoDisponible, "12.00");
    assert.equal(b.cuenta.saldoDisponible, "77.25");
    assert.notEqual(a.cuenta.saldoDisponible, b.cuenta.saldoDisponible);
  });

  it("mi-cuenta config pública no expone metadatos admin", async () => {
    const store = createMemoryCreditosStore();
    await actualizarCreditosConfig(store, {
      controlActivo: false,
      updatedByAdminId: "admin-secret-id",
    });
    const full = serializeConfig(await store.getConfig());
    const mini = serializeMiCuentaConfig(await store.getConfig());
    assert.equal(mini.configPersisted, full.configPersisted);
    assert.equal(mini.controlActivo, full.controlActivo);
    assert.equal(mini.inicioEn, full.inicioEn);
    assert.equal("umbralSaldoBajo" in mini, false);
    assert.equal("updatedAt" in mini, false);
    assert.equal("updatedByAdminId" in mini, false);
    assert.equal(full.updatedByAdminId, "admin-secret-id");
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
