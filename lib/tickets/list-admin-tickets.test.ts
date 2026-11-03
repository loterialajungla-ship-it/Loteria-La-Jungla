import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import { TICKET_CREATOR_UNAVAILABLE_LABEL } from "@/lib/tickets/ticket-creator-display";

function money(n: string) {
  return { toFixed: () => n, toString: () => n } as unknown as {
    toFixed: (d?: number) => string;
  };
}

describe("listAdminTickets — creador", () => {
  it("ADMIN ve creador por vendedor distinto y No disponible histórico", async () => {
    const tickets = [
      {
        id: "t1",
        numeroVisible: "LJ-1",
        fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
        createdAt: new Date("2026-11-03T14:00:00.000Z"),
        totalApostado: money("10.00"),
        estado: "EMITIDO" as const,
        multiplicadorUsado: 30,
        vendedorId: "v1",
        vendedor: {
          id: "v1",
          nombre: "Vendedor Uno",
          usuario: "vend1",
          rol: "VENDEDOR" as const,
        },
        lineas: [],
      },
      {
        id: "t2",
        numeroVisible: "LJ-2",
        fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
        createdAt: new Date("2026-11-03T15:00:00.000Z"),
        totalApostado: money("5.00"),
        estado: "EMITIDO" as const,
        multiplicadorUsado: 30,
        vendedorId: "v2",
        vendedor: {
          id: "v2",
          nombre: "Vendedor Dos",
          usuario: "vend2",
          rol: "VENDEDOR" as const,
        },
        lineas: [],
      },
      {
        id: "t-hist",
        numeroVisible: "LJ-H",
        fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
        createdAt: new Date("2026-10-01T12:00:00.000Z"),
        totalApostado: money("1.00"),
        estado: "EMITIDO" as const,
        multiplicadorUsado: 30,
        vendedorId: null,
        vendedor: null,
        lineas: [],
      },
      {
        id: "t-admin",
        numeroVisible: "LJ-A",
        fechaJuego: new Date("2026-11-03T00:00:00.000Z"),
        createdAt: new Date("2026-11-03T16:00:00.000Z"),
        totalApostado: money("20.00"),
        estado: "EMITIDO" as const,
        multiplicadorUsado: 30,
        vendedorId: "adm1",
        vendedor: {
          id: "adm1",
          nombre: "Admin Jungla",
          usuario: "adminlajungla",
          rol: "ADMIN" as const,
        },
        lineas: [],
      },
    ];

    const db = {
      ticket: {
        count: async () => tickets.length,
        findMany: async () => tickets,
      },
      resultado: {
        findMany: async () => [],
      },
    };

    const result = await listAdminTickets(db as never, {
      fecha: "2026-11-03",
      page: "1",
      pageSize: "50",
    });

    assert.equal(result.items.length, 4);
    assert.equal(result.items[0]!.creadoPor.etiqueta, "Vendedor Uno");
    assert.equal(result.items[0]!.creadoPor.usuario, "vend1");
    assert.equal(result.items[1]!.creadoPor.etiqueta, "Vendedor Dos");
    assert.equal(
      result.items[2]!.creadoPor.etiqueta,
      TICKET_CREATOR_UNAVAILABLE_LABEL,
    );
    assert.equal(result.items[2]!.creadoPor.disponible, false);
    assert.match(result.items[3]!.creadoPor.etiqueta, /Administrador/);
    assert.ok(result.items[0]!.createdAt.includes("2026-11-03"));
  });

  it("incluye vendedor en la query (no confía en el cliente)", async () => {
    let include: unknown;
    const db = {
      ticket: {
        count: async () => 0,
        findMany: async (args: { include?: unknown }) => {
          include = args.include;
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };
    await listAdminTickets(db as never, { page: "1" });
    assert.deepEqual(
      (include as { vendedor: { select: unknown } }).vendedor.select,
      { id: true, nombre: true, usuario: true, rol: true },
    );
  });
});
