import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CREATE_TICKET_CONFLICT_FALLBACK,
  CREATE_TICKET_DEFAULT_TITLE,
  CREATE_TICKET_GENERIC_FALLBACK,
  CREATE_TICKET_INSUFFICIENT_MESSAGE,
  CREATE_TICKET_INSUFFICIENT_TITLE,
  CREATE_TICKET_NETWORK_FALLBACK,
  CREATE_TICKET_UNAUTHORIZED_MESSAGE,
  mapCreateTicketClientResponse,
  mapCreateTicketNetworkError,
} from "@/lib/tickets/ui/map-create-ticket-error";

const ticketStub = {
  id: "t1",
  numeroVisible: "000001",
  totalApostado: "10.00",
};

describe("mapCreateTicketClientResponse — saldo insuficiente", () => {
  it("INSUFFICIENT_CREDITO_SALDO muestra el copy específico", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "INSUFFICIENT_CREDITO_SALDO",
        message: "Saldo de créditos insuficiente.",
      },
    });
    assert.equal(out.kind, "insufficient_credito_saldo");
    assert.equal(out.title, CREATE_TICKET_INSUFFICIENT_TITLE);
    assert.equal(out.message, CREATE_TICKET_INSUFFICIENT_MESSAGE);
    assert.equal(out.refreshSaldo, true);
    assert.equal(out.clearApuestas, false);
    assert.equal(out.clearIdempotencyKey, true);
    assert.equal(out.autoRetryPost, false);
  });

  it("no clasifica por texto del mensaje si el code no es saldo", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Saldo de créditos insuficiente.",
      },
    });
    assert.equal(out.kind, "conflict");
    assert.notEqual(out.message, CREATE_TICKET_INSUFFICIENT_MESSAGE);
    assert.equal(out.refreshSaldo, false);
  });
});

describe("mapCreateTicketClientResponse — otros 409", () => {
  it("IDEMPOTENCY_CONFLICT muestra conflicto, no saldo insuficiente", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Esta operación no puede reutilizarse.",
      },
    });
    assert.equal(out.kind, "conflict");
    assert.equal(out.title, CREATE_TICKET_DEFAULT_TITLE);
    assert.equal(out.message, "Esta operación no puede reutilizarse.");
    assert.equal(out.refreshSaldo, false);
    assert.notEqual(out.message, CREATE_TICKET_INSUFFICIENT_MESSAGE);
  });

  it("IDEMPOTENCY_PAYLOAD_MISMATCH muestra conflicto, no saldo insuficiente", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        message: "Esta clave de operación ya fue utilizada con otros datos.",
      },
    });
    assert.equal(out.kind, "conflict");
    assert.equal(out.refreshSaldo, false);
    assert.notEqual(out.message, CREATE_TICKET_INSUFFICIENT_MESSAGE);
    assert.match(out.message, /clave de operación/i);
  });

  it("CREDITO_IDEMPOTENCY_CONFLICT no se confunde con saldo", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "CREDITO_IDEMPOTENCY_CONFLICT",
        message: "Esta operación de créditos ya fue utilizada con otros datos.",
      },
    });
    assert.equal(out.kind, "conflict");
    assert.equal(out.refreshSaldo, false);
    assert.notEqual(out.kind, "insufficient_credito_saldo");
  });

  it("CONFLICT mantiene el fallback correspondiente", () => {
    const withMsg = mapCreateTicketClientResponse(409, {
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Conflicto de unicidad al crear el ticket. Reintente.",
      },
    });
    assert.equal(withMsg.kind, "conflict");
    assert.equal(
      withMsg.message,
      "Conflicto de unicidad al crear el ticket. Reintente.",
    );
    assert.equal(withMsg.refreshSaldo, false);

    const withoutMsg = mapCreateTicketClientResponse(409, {
      ok: false,
      error: { code: "CONFLICT" },
    });
    assert.equal(withoutMsg.kind, "conflict");
    if (withoutMsg.kind !== "conflict") return;
    assert.equal(withoutMsg.message, CREATE_TICKET_CONFLICT_FALLBACK);
  });

  it("respuesta 409 sin error.code usa fallback genérico de conflicto", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: { message: "algo raro" },
    });
    assert.equal(out.kind, "conflict");
    assert.equal(out.message, "algo raro");
    assert.equal(out.refreshSaldo, false);

    const empty = mapCreateTicketClientResponse(409, { ok: false });
    assert.equal(empty.kind, "conflict");
    assert.equal(empty.message, CREATE_TICKET_CONFLICT_FALLBACK);
    assert.equal(empty.refreshSaldo, false);
  });
});

describe("mapCreateTicketClientResponse — conservación y efectos", () => {
  it("409 de saldo no limpia apuestas ni reintenta POST", () => {
    const out = mapCreateTicketClientResponse(409, {
      ok: false,
      error: { code: "INSUFFICIENT_CREDITO_SALDO" },
    });
    assert.equal(out.clearApuestas, false);
    assert.equal(out.autoRetryPost, false);
    assert.equal(out.refreshHoras, false);
  });

  it("refreshSaldo solo para INSUFFICIENT_CREDITO_SALDO (y éxito)", () => {
    const codes = [
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "CREDITO_IDEMPOTENCY_CONFLICT",
      "CONFLICT",
      undefined,
    ] as const;
    for (const code of codes) {
      const out = mapCreateTicketClientResponse(409, {
        ok: false,
        error: code ? { code } : undefined,
      });
      assert.equal(out.refreshSaldo, false, `code=${String(code)}`);
    }
    const saldo = mapCreateTicketClientResponse(409, {
      ok: false,
      error: { code: "INSUFFICIENT_CREDITO_SALDO" },
    });
    assert.equal(saldo.refreshSaldo, true);
  });
});

describe("mapCreateTicketClientResponse — otros errores existentes", () => {
  it("401 conserva mensaje de sesión", () => {
    const out = mapCreateTicketClientResponse(401, {
      ok: false,
      error: { code: "UNAUTHORIZED", message: "ignored" },
    });
    assert.equal(out.kind, "unauthorized");
    assert.equal(out.message, CREATE_TICKET_UNAUTHORIZED_MESSAGE);
    assert.equal(out.clearIdempotencyKey, false);
    assert.equal(out.refreshSaldo, false);
  });

  it("DRAW_CLOSED conserva comportamiento y refresca horas", () => {
    const out = mapCreateTicketClientResponse(400, {
      ok: false,
      error: {
        code: "DRAW_CLOSED",
        message: "El sorteo de las 10:00 ya no acepta apuestas.",
      },
    });
    assert.equal(out.kind, "draw_closed");
    assert.match(out.message, /10:00/);
    assert.equal(out.refreshHoras, true);
    assert.equal(out.refreshSaldo, false);
    assert.equal(out.clearApuestas, false);
    assert.equal(out.clearIdempotencyKey, false);
  });

  it("error genérico 500 usa fallback o message del servidor", () => {
    const withMsg = mapCreateTicketClientResponse(500, {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
    });
    assert.equal(withMsg.kind, "generic_error");
    assert.equal(withMsg.message, "Error interno del servidor.");
    assert.equal(withMsg.refreshSaldo, false);

    const bare = mapCreateTicketClientResponse(500, { ok: false });
    assert.equal(bare.kind, "generic_error");
    if (bare.kind !== "generic_error") return;
    assert.equal(bare.message, CREATE_TICKET_GENERIC_FALLBACK);
  });

  it("504 (p. ej. FUNCTION_INVOCATION_TIMEOUT) conserva idempotencyKey", () => {
    const out = mapCreateTicketClientResponse(504, {
      ok: false,
      error: { code: "FUNCTION_INVOCATION_TIMEOUT" },
    });
    assert.equal(out.kind, "generic_error");
    assert.equal(out.clearIdempotencyKey, false);
    assert.equal(out.autoRetryPost, false);
  });


  it("éxito limpia apuestas, key y refresca saldo; sin auto-retry", () => {
    const out = mapCreateTicketClientResponse(201, {
      ok: true,
      ticket: ticketStub,
    });
    assert.equal(out.kind, "success");
    assert.equal(out.clearApuestas, true);
    assert.equal(out.clearIdempotencyKey, true);
    assert.equal(out.refreshSaldo, true);
    assert.equal(out.autoRetryPost, false);
  });

  it("network error no limpia key ni apuestas ni reintenta", () => {
    const out = mapCreateTicketNetworkError();
    assert.equal(out.kind, "network_error");
    assert.equal(out.message, CREATE_TICKET_NETWORK_FALLBACK);
    assert.equal(out.clearIdempotencyKey, false);
    assert.equal(out.clearApuestas, false);
    assert.equal(out.autoRetryPost, false);
    assert.equal(out.refreshSaldo, false);
  });
});

describe("TicketPOS — integración del mapper (fuente)", () => {
  const src = readFileSync(
    path.join(process.cwd(), "components/tickets/TicketPOS.tsx"),
    "utf8",
  );

  it("usa el mapper y no clasifica 409 por regex de mensaje", () => {
    assert.match(src, /mapCreateTicketClientResponse/);
    assert.match(src, /mapCreateTicketNetworkError/);
    assert.doesNotMatch(src, /saldo\|cr\[eé\]dito/);
    assert.doesNotMatch(src, /\/saldo\|/);
  });

  it("refresca saldo solo vía flag del outcome (sin segundo POST automático)", () => {
    assert.match(src, /outcome\.refreshSaldo/);
    assert.match(src, /autoRetryPost/);
    // Un único fetch de creación en crearTicket
    const posts = src.match(/fetch\("\/api\/venta\/tickets"/g) ?? [];
    assert.equal(posts.length, 1);
  });

  it("conserva idempotencyKeyRef entre reintentos manuales hasta éxito/conflicto", () => {
    assert.match(src, /idempotencyKeyRef/);
    assert.match(
      src,
      /Misma key mientras la operación pendiente\/reintento; nueva venta = nueva key/,
    );
    assert.match(src, /if \(!idempotencyKeyRef\.current\)/);
    assert.match(src, /outcome\.clearIdempotencyKey/);
    assert.doesNotMatch(src, /AbortSignal|AbortController|signal:/);
    assert.match(
      src,
      /autoRetryPost siempre false: el vendedor reintenta manualmente/,
    );
  });

  it("Alert usa título y mensaje del error de presentación", () => {
    assert.match(src, /title=\{error\.title\}/);
    assert.match(src, /\{error\.message\}/);
  });
});

