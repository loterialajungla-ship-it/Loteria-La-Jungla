import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_TICKET_SORT_KEYS,
  parseAdminListTicketsQuery,
} from "@/lib/tickets/admin-ticket-query";
import {
  VENDOR_TICKET_ORDER_BY_DEFAULT,
  VENDOR_TICKET_SORT_KEYS,
  buildVendorTicketOrderBy,
} from "@/lib/tickets/vendor-ticket-sort";
import { listVendorTickets } from "@/lib/tickets/vendor-tickets";

describe("VENDOR_TICKET_SORT_KEYS — paridad parser", () => {
  it("coincide exactamente con ADMIN_TICKET_SORT_KEYS (5 claves)", () => {
    assert.deepEqual([...VENDOR_TICKET_SORT_KEYS], [...ADMIN_TICKET_SORT_KEYS]);
    assert.deepEqual([...VENDOR_TICKET_SORT_KEYS], [
      "numeroVisible",
      "fechaJuego",
      "createdAt",
      "totalApostado",
      "estado",
    ]);
  });

  it("parseAdminListTicketsQuery admite las cinco claves vendor", () => {
    for (const key of VENDOR_TICKET_SORT_KEYS) {
      assert.deepEqual(
        parseAdminListTicketsQuery({ sort: key, dir: "asc" }).sort,
        { key, dir: "asc" },
      );
      assert.deepEqual(
        parseAdminListTicketsQuery({ sort: key, dir: "desc" }).sort,
        { key, dir: "desc" },
      );
    }
  });
});

describe("buildVendorTicketOrderBy", () => {
  it("default createdAt DESC + id DESC", () => {
    assert.deepEqual(
      buildVendorTicketOrderBy({ key: null, dir: null }),
      VENDOR_TICKET_ORDER_BY_DEFAULT,
    );
    assert.deepEqual(VENDOR_TICKET_ORDER_BY_DEFAULT, [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("cada columna ASC/DESC con desempate id DESC", () => {
    for (const key of VENDOR_TICKET_SORT_KEYS) {
      assert.deepEqual(buildVendorTicketOrderBy({ key, dir: "asc" }), [
        { [key]: "asc" },
        { id: "desc" },
      ]);
      assert.deepEqual(buildVendorTicketOrderBy({ key, dir: "desc" }), [
        { [key]: "desc" },
        { id: "desc" },
      ]);
    }
  });

  it("criterio estado = campo persistido EMITIDO|ANULADO (no estadoDerivado)", () => {
    // UI de /venta/tickets muestra badge de estadoDerivado
    // (ANULADO|PENDIENTE|GANADOR|NO_GANADOR); el orderBy SQL usa ticket.estado.
    assert.deepEqual(
      buildVendorTicketOrderBy({ key: "estado", dir: "asc" }),
      [{ estado: "asc" }, { id: "desc" }],
    );
    assert.deepEqual(
      buildVendorTicketOrderBy({ key: "estado", dir: "desc" }),
      [{ estado: "desc" }, { id: "desc" }],
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "estadoDerivado", dir: "asc" }).sort,
      { key: null, dir: null },
    );
    assert.equal(
      (VENDOR_TICKET_SORT_KEYS as readonly string[]).includes("estadoDerivado"),
      false,
    );
  });
});

describe("listVendorTickets — orderBy + aislamiento (mock)", () => {
  it("aplica orderBy tipado antes de skip/take y conserva where de vendedor", async () => {
    const findArgs: unknown[] = [];
    const db = {
      ticket: {
        count: async () => 30,
        findMany: async (args: unknown) => {
          findArgs.push(args);
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };

    const result = await listVendorTickets(
      db as never,
      { userId: "vend-a", rol: "VENDEDOR" },
      {
        fecha: "2026-10-01",
        estado: "EMITIDO",
        page: "2",
        pageSize: "10",
        sort: "totalApostado",
        dir: "asc",
      },
    );

    assert.equal(result.pagination.total, 30);
    assert.equal(result.pagination.page, 2);
    assert.equal(findArgs.length, 1);
    const args = findArgs[0] as {
      where: { vendedorId: string; estado: string };
      orderBy: unknown;
      skip: number;
      take: number;
    };
    assert.equal(args.where.vendedorId, "vend-a");
    assert.equal(args.where.estado, "EMITIDO");
    assert.equal(args.skip, 10);
    assert.equal(args.take, 10);
    assert.deepEqual(args.orderBy, [
      { totalApostado: "asc" },
      { id: "desc" },
    ]);
  });

  it("sin sort usa createdAt desc + id desc", async () => {
    let orderBy: unknown;
    const db = {
      ticket: {
        count: async () => 0,
        findMany: async (args: { orderBy: unknown }) => {
          orderBy = args.orderBy;
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };
    await listVendorTickets(
      db as never,
      { userId: "vend-a", rol: "VENDEDOR" },
      {},
    );
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("sort/dir inválidos → fallback default", async () => {
    let orderBy: unknown;
    const db = {
      ticket: {
        count: async () => 0,
        findMany: async (args: { orderBy: unknown }) => {
          orderBy = args.orderBy;
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };
    await listVendorTickets(
      db as never,
      { userId: "vend-a", rol: "VENDEDOR" },
      { sort: "passwordHash", dir: "asc" },
    );
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "evil", dir: "asc" }).sort,
      { key: null, dir: null },
    );
  });

  it("VENDEDOR ignora vendedorId de query (solo actor.userId)", async () => {
    let where: { vendedorId?: string } = {};
    const db = {
      ticket: {
        count: async () => 0,
        findMany: async (args: { where: { vendedorId?: string } }) => {
          where = args.where;
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };
    await listVendorTickets(
      db as never,
      { userId: "vend-a", rol: "VENDEDOR" },
      Object.assign(
        { sort: "numeroVisible", dir: "desc" },
        { vendedorId: "vend-b" },
      ),
    );
    assert.equal(where.vendedorId, "vend-a");
  });

  it("ADMIN no fuerza filtro vendedorId", async () => {
    let where: { vendedorId?: string } = { vendedorId: "sentinel" };
    const db = {
      ticket: {
        count: async () => 0,
        findMany: async (args: { where: { vendedorId?: string } }) => {
          where = args.where;
          return [];
        },
      },
      resultado: { findMany: async () => [] },
    };
    await listVendorTickets(
      db as never,
      { userId: "admin-1", rol: "ADMIN" },
      { sort: "estado", dir: "asc" },
    );
    assert.equal(where.vendedorId, undefined);
  });
});
