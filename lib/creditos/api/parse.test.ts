import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CreditoValidationError } from "@/lib/creditos/errors";
import {
  parseAsignarRetirarBody,
  parseConfigPatchBody,
  parseCorregirBody,
  parseCreditoIdempotencyKey,
  parseHistorialQuery,
  parseInicioEnInstante,
  parseResumenQuery,
} from "@/lib/creditos/api/parse";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("parse créditos API", () => {
  it("exige UUID de idempotencia", () => {
    assert.equal(parseCreditoIdempotencyKey(UUID), UUID);
    assert.throws(
      () => parseCreditoIdempotencyKey("no-uuid"),
      CreditoValidationError,
    );
  });

  it("rechaza suplantar actor/vendedor en body de asignación", () => {
    assert.throws(
      () =>
        parseAsignarRetirarBody({
          importe: "10.00",
          idempotencyKey: UUID,
          actorAdminId: "hacker",
        }),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_CAMPO_PROHIBIDO",
    );
    assert.throws(
      () =>
        parseAsignarRetirarBody({
          importe: "10.00",
          idempotencyKey: UUID,
          vendedorId: "otro",
        }),
      CreditoValidationError,
    );
  });

  it("parsea asignación válida", () => {
    const p = parseAsignarRetirarBody({
      importe: "12.50",
      motivo: "carga inicial",
      idempotencyKey: UUID.toUpperCase(),
    });
    assert.equal(p.importe, "12.50");
    assert.equal(p.motivo, "carga inicial");
    assert.equal(p.idempotencyKey, UUID);
  });

  it("rechaza importe numérico JSON (evita float)", () => {
    assert.throws(
      () =>
        parseAsignarRetirarBody({
          importe: 10.5,
          idempotencyKey: UUID,
        }),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_IMPORTE_INVALIDO",
    );
  });

  it("parsea corrección con efecto", () => {
    const p = parseCorregirBody({
      importe: "1.00",
      efecto: "disminuir",
      movimientoOrigenId: "cm_abc",
      idempotencyKey: UUID,
    });
    assert.equal(p.efecto, "DISMINUIR");
    assert.equal(p.movimientoOrigenId, "cm_abc");
  });

  it("inicioEn exige instante con zona; null permitido", () => {
    assert.equal(parseInicioEnInstante(null), null);
    const d = parseInicioEnInstante("2026-11-01T04:00:00.000Z");
    assert.equal(d?.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.throws(
      () => parseInicioEnInstante("2026-11-01T00:00:00"),
      (e: unknown) =>
        e instanceof CreditoValidationError &&
        e.code === "CREDITO_INICIO_INVALIDO",
    );
  });

  it("config patch no activa por defecto y valida umbral", () => {
    const p = parseConfigPatchBody({
      inicioEn: "2026-11-01T04:00:00.000Z",
      controlActivo: false,
      umbralSaldoBajo: "50.00",
    });
    assert.equal(p.controlActivo, false);
    assert.equal(p.umbralSaldoBajo, "50.00");
    assert.throws(() => parseConfigPatchBody({}), CreditoValidationError);
    assert.throws(
      () => parseConfigPatchBody({ updatedByAdminId: "x" }),
      CreditoValidationError,
    );
  });

  it("filtros de resumen e historial", () => {
    const r = parseResumenQuery(
      new URLSearchParams("activo=activos&page=2&pageSize=10"),
    );
    assert.equal(r.activo, true);
    assert.equal(r.page, 2);

    const h = parseHistorialQuery(
      new URLSearchParams(
        "tipo=CONSUMO_VENTA&desde=2026-01-01T00:00:00.000Z&hasta=2026-12-31T23:59:59.000Z",
      ),
    );
    assert.equal(h.tipo, "CONSUMO_VENTA");
    assert.ok(h.desde);
    assert.ok(h.hasta);
  });
});
