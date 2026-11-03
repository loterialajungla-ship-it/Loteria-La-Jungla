import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublicTicketByCodigo } from "@/lib/tickets/get-public-ticket";
import { getVendorTicketById } from "@/lib/tickets/vendor-tickets";
import { TicketNotFoundError } from "@/lib/tickets/errors";

function money(n: string) {
  return n as unknown as { toString(): string };
}

const baseTicket = {
  id: "t-priv",
  numeroVisible: "LJ-P",
  codigoPublico: "codigo-publico-xyz",
  fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
  createdAt: new Date("2026-11-03T12:00:00.000Z"),
  totalApostado: money("3.00"),
  estado: "EMITIDO" as const,
  multiplicadorUsado: 30,
  vendedorId: "otro-vendedor",
  lineas: [],
};

describe("privacidad del creador", () => {
  it("consulta pública no revela creador ni vendedorId", async () => {
    const db = {
      ticket: {
        findUnique: async () => baseTicket,
      },
      resultado: { findMany: async () => [] },
    };
    const pub = await getPublicTicketByCodigo("codigo-publico-xyz", db as never);
    assert.ok(pub);
    const keys = Object.keys(pub!);
    assert.equal(keys.includes("creadoPor"), false);
    assert.equal(keys.includes("vendedorId"), false);
    assert.equal(keys.includes("vendedor"), false);
    assert.equal(
      JSON.stringify(pub).includes("otro-vendedor"),
      false,
    );
  });

  it("VENDEDOR no ve tickets ajenos (ni datos del otro vendedor)", async () => {
    const db = {
      ticket: {
        findUnique: async () => baseTicket,
      },
      resultado: { findMany: async () => [] },
    };
    await assert.rejects(
      () =>
        getVendorTicketById(
          db as never,
          { rol: "VENDEDOR", userId: "yo-vendedor" },
          "t-priv",
        ),
      (e: unknown) => e instanceof TicketNotFoundError,
    );
  });

  it("detalle VENDEDOR propio no expone vendedorId/creadoPor", async () => {
    const mine = { ...baseTicket, vendedorId: "yo-vendedor" };
    const db = {
      ticket: {
        findUnique: async () => mine,
      },
      resultado: { findMany: async () => [] },
    };
    const det = await getVendorTicketById(
      db as never,
      { rol: "VENDEDOR", userId: "yo-vendedor" },
      "t-priv",
    );
    const keys = Object.keys(det);
    assert.equal(keys.includes("creadoPor"), false);
    assert.equal(keys.includes("vendedorId"), false);
    assert.equal(JSON.stringify(det).includes("yo-vendedor"), false);
  });
});
