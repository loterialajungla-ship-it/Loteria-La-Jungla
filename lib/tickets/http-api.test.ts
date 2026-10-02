import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  ConfigurationError,
  DrawClosedError,
  IdempotencyConflictError,
  InvalidAnulacionMotivoError,
  InvalidGameDateError,
  TicketAlreadyAnuladoError,
  TicketNotFoundError,
  TicketValidationError,
} from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";

describe("parseCreateTicketBody", () => {
  it("acepta body válido", () => {
    const input = parseCreateTicketBody({
      fechaJuego: "2026-10-01",
      vendedorId: null,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
    });
    assert.equal(input.fechaJuego, "2026-10-01");
    assert.equal(input.vendedorId, null);
    assert.equal(input.idempotencyKey, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(input.lineas.length, 1);
  });

  it("exige idempotencyKey UUID", () => {
    assert.throws(
      () =>
        parseCreateTicketBody({
          fechaJuego: "2026-10-01",
          lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
        }),
      TicketValidationError,
    );
  });

  it("rechaza body no objeto", () => {
    assert.throws(() => parseCreateTicketBody([]), TicketValidationError);
    assert.throws(() => parseCreateTicketBody(null), TicketValidationError);
  });

  it("rechaza campos prohibidos (totalApostado, etc.)", () => {
    assert.throws(
      () =>
        parseCreateTicketBody({
          fechaJuego: "2026-10-01",
          totalApostado: "10.00",
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
          lineas: [{ hora: 10, numeroAnimal: "03", importe: "2.00" }],
        }),
      TicketValidationError,
    );
  });

  it("rechaza lineas no array", () => {
    assert.throws(
      () =>
        parseCreateTicketBody({
          fechaJuego: "2026-10-01",
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
          lineas: "no",
        }),
      TicketValidationError,
    );
  });
});

describe("mapTicketErrorToHttp", () => {
  it("mapea validación de dominio a 400", () => {
    const mapped = mapTicketErrorToHttp(new InvalidGameDateError());
    assert.equal(mapped.status, 400);
    assert.equal(mapped.body.ok, false);
    assert.equal(mapped.body.error.code, "INVALID_GAME_DATE");
  });

  it("mapea DrawClosedError a 400 con mensaje amigable", () => {
    const mapped = mapTicketErrorToHttp(new DrawClosedError(10));
    assert.equal(mapped.status, 400);
    assert.equal(mapped.body.error.code, "DRAW_CLOSED");
    assert.match(mapped.body.error.message, /10:00/);
  });

  it("mapea TicketNotFoundError a 404", () => {
    const mapped = mapTicketErrorToHttp(new TicketNotFoundError());
    assert.equal(mapped.status, 404);
  });

  it("mapea TicketAlreadyAnuladoError a 409", () => {
    const mapped = mapTicketErrorToHttp(new TicketAlreadyAnuladoError());
    assert.equal(mapped.status, 409);
  });

  it("mapea IdempotencyConflictError a 409", () => {
    const mapped = mapTicketErrorToHttp(
      new IdempotencyConflictError(
        "Esta clave de operación ya fue utilizada con otros datos.",
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
      ),
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.body.error.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");
  });

  it("mapea InvalidAnulacionMotivoError a 400", () => {
    const mapped = mapTicketErrorToHttp(new InvalidAnulacionMotivoError());
    assert.equal(mapped.status, 400);
  });

  it("mapea ConfigurationError a 500 sin filtrar detalles internos", () => {
    const mapped = mapTicketErrorToHttp(
      new ConfigurationError("secreto interno"),
    );
    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.error.message, "Error de configuración del servidor.");
  });

  it("mapea P2002 a 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    const mapped = mapTicketErrorToHttp(err);
    assert.equal(mapped.status, 409);
  });

  it("mapea error desconocido a 500 genérico", () => {
    const mapped = mapTicketErrorToHttp(new Error("boom prisma detail"));
    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.error.code, "INTERNAL_ERROR");
    assert.equal(mapped.body.error.message, "Error interno del servidor.");
  });
});
