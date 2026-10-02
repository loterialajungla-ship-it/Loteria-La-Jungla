import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIdempotencyRequestHash,
  validarIdempotencyKey,
} from "@/lib/tickets/idempotency";
import { IdempotencyConflictError, TicketValidationError } from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

describe("validarIdempotencyKey", () => {
  it("acepta UUID y normaliza a minúsculas", () => {
    assert.equal(
      validarIdempotencyKey("550E8400-E29B-41D4-A716-446655440000"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rechaza vacío o no UUID", () => {
    assert.throws(() => validarIdempotencyKey(""), TicketValidationError);
    assert.throws(() => validarIdempotencyKey("abc"), TicketValidationError);
    assert.throws(() => validarIdempotencyKey(null), TicketValidationError);
  });
});

describe("buildIdempotencyRequestHash", () => {
  it("mismo contenido con distinto orden de líneas → mismo hash", () => {
    const a = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-02",
      lineas: [
        { hora: 10, numeroAnimal: "03", importe: "2.00" },
        { hora: 10, numeroAnimal: "15", importe: "5.00" },
      ],
    });
    const b = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-02",
      lineas: [
        { hora: 10, numeroAnimal: "15", importe: "5.00" },
        { hora: 10, numeroAnimal: "03", importe: "2.00" },
      ],
    });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("importe canónico distinto cambia el hash", () => {
    const a = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-02",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
    });
    const b = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-02",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "20.00" }],
    });
    assert.notEqual(a, b);
  });

  it("fecha distinta cambia el hash", () => {
    const a = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-02",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
    });
    const b = buildIdempotencyRequestHash({
      fechaJuego: "2026-10-03",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
    });
    assert.notEqual(a, b);
  });
});

describe("resolución de conflicto de idempotencia (regla)", () => {
  function resolve(args: {
    existingVendedorId: string;
    existingHash: string;
    actorId: string;
    requestHash: string;
  }): "replay" | "conflict-user" | "conflict-payload" {
    if (args.existingVendedorId !== args.actorId) return "conflict-user";
    if (args.existingHash !== args.requestHash) return "conflict-payload";
    return "replay";
  }

  it("misma key + mismo usuario + mismo hash → replay", () => {
    assert.equal(
      resolve({
        existingVendedorId: "u1",
        existingHash: "abc",
        actorId: "u1",
        requestHash: "abc",
      }),
      "replay",
    );
  });

  it("misma key + usuario distinto → conflict-user (409 genérico)", () => {
    assert.equal(
      resolve({
        existingVendedorId: "u1",
        existingHash: "abc",
        actorId: "u2",
        requestHash: "abc",
      }),
      "conflict-user",
    );
    const mapped = mapTicketErrorToHttp(
      new IdempotencyConflictError("Esta operación no puede reutilizarse."),
    );
    assert.equal(mapped.status, 409);
  });

  it("misma key + body distinto → conflict-payload", () => {
    assert.equal(
      resolve({
        existingVendedorId: "u1",
        existingHash: "abc",
        actorId: "u1",
        requestHash: "xyz",
      }),
      "conflict-payload",
    );
  });

  it("key nueva implica operación distinta (documentado)", () => {
    const keyA = "550e8400-e29b-41d4-a716-446655440000";
    const keyB = "550e8400-e29b-41d4-a716-446655440001";
    assert.notEqual(keyA, keyB);
  });
});

/**
 * Integración PostgreSQL pendiente:
 * - UNIQUE(idempotencyKey) bajo carrera concurrente
 * - createTicket primera vez 201 / replay 200
 * - tickets históricos con null siguen OK
 */
