import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAdminTicketById } from "@/lib/tickets/get-admin-ticket";
import { TICKET_CREATOR_UNAVAILABLE_LABEL } from "@/lib/tickets/ticket-creator-display";

function money(n: string) {
  return { toFixed: () => n, toString: () => n } as unknown as {
    toFixed: (d?: number) => string;
  };
}

describe("getAdminTicketById — creador", () => {
  it("detalle ADMIN expone nombre, usuario y createdAt", async () => {
    const db = {
      ticket: {
        findUnique: async () => ({
          id: "t1",
          numeroVisible: "LJ-1",
          codigoPublico: "pub-1",
          fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
          createdAt: new Date("2026-11-03T14:30:00.000Z"),
          totalApostado: money("12.00"),
          estado: "EMITIDO" as const,
          multiplicadorUsado: 30,
          anuladoAt: null,
          anuladoPorId: null,
          motivoAnulacion: null,
          vendedorId: "v1",
          vendedor: {
            id: "v1",
            nombre: "Carla",
            usuario: "carla01",
            rol: "VENDEDOR" as const,
          },
          lineas: [],
        }),
      },
      resultado: { findMany: async () => [] },
    };

    const ticket = await getAdminTicketById(db as never, "t1");
    assert.equal(ticket.creadoPor.disponible, true);
    assert.equal(ticket.creadoPor.nombre, "Carla");
    assert.equal(ticket.creadoPor.usuario, "carla01");
    assert.equal(ticket.creadoPor.etiqueta, "Carla");
    assert.equal(ticket.createdAt, new Date("2026-11-03T14:30:00.000Z").toISOString());
  });

  it("histórico sin vendedorId → No disponible", async () => {
    const db = {
      ticket: {
        findUnique: async () => ({
          id: "th",
          numeroVisible: "LJ-H",
          codigoPublico: "pub-h",
          fechaJuego: new Date("2026-01-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T10:00:00.000Z"),
          totalApostado: money("1.00"),
          estado: "EMITIDO" as const,
          multiplicadorUsado: 30,
          anuladoAt: null,
          anuladoPorId: null,
          motivoAnulacion: null,
          vendedorId: null,
          vendedor: null,
          lineas: [],
        }),
      },
      resultado: { findMany: async () => [] },
    };
    const ticket = await getAdminTicketById(db as never, "th");
    assert.equal(ticket.creadoPor.disponible, false);
    assert.equal(ticket.creadoPor.etiqueta, TICKET_CREATOR_UNAVAILABLE_LABEL);
  });
});
