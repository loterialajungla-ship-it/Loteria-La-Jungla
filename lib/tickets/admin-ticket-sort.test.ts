import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseAdminListTicketsQuery,
} from "@/lib/tickets/admin-ticket-query";
import {
  ADMIN_TICKET_ORDER_BY_DEFAULT,
  ADMIN_TICKET_SORT_KEYS,
  buildAdminTicketOrderBy,
} from "@/lib/tickets/admin-ticket-sort";
import { listAdminTickets } from "@/lib/tickets/list-admin-tickets";
import { buildQuery } from "@/lib/ui/build-query";
import { cycleTableSort } from "@/lib/ui/table-sort";

describe("parseAdminListTicketsQuery — sort/dir", () => {
  it("sin sort/dir → estado default null/null", () => {
    const f = parseAdminListTicketsQuery({});
    assert.deepEqual(f.sort, { key: null, dir: null });
  });

  it("acepta las cinco claves ASC y DESC", () => {
    for (const key of ADMIN_TICKET_SORT_KEYS) {
      assert.deepEqual(
        parseAdminListTicketsQuery({ sort: key, dir: "asc" }).sort,
        { key, dir: "asc" },
      );
      assert.deepEqual(
        parseAdminListTicketsQuery({ sort: key, dir: "DESC" }).sort,
        { key, dir: "desc" },
      );
    }
  });

  it("dir case-insensitive; clave case-sensitive", () => {
    assert.equal(
      parseAdminListTicketsQuery({ sort: "createdAt", dir: "AsC" }).sort.dir,
      "asc",
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "CreatedAt", dir: "asc" }).sort,
      { key: null, dir: null },
    );
  });

  it("rechaza claves no permitidas e estadoDerivado", () => {
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "estadoDerivado", dir: "asc" }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "vendedorId", dir: "asc" }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "passwordHash", dir: "desc" }).sort,
      { key: null, dir: null },
    );
  });

  it("valores ausentes, inválidos, no-string → default", () => {
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "createdAt", dir: "sideways" }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ sort: "createdAt" }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({ dir: "asc" }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({
        sort: ["createdAt"] as unknown as string,
        dir: "asc",
      }).sort,
      { key: null, dir: null },
    );
    assert.deepEqual(
      parseAdminListTicketsQuery({
        sort: "createdAt",
        dir: 1 as unknown as string,
      }).sort,
      { key: null, dir: null },
    );
  });

  it("preserva filtros junto con sort válido", () => {
    const f = parseAdminListTicketsQuery({
      fecha: "2026-10-01",
      estado: "EMITIDO",
      numero: "lj-20261001-000001",
      page: "2",
      sort: "totalApostado",
      dir: "desc",
    });
    assert.equal(f.fechaJuegoStr, "2026-10-01");
    assert.equal(f.estado, "EMITIDO");
    assert.equal(f.numeroVisible, "LJ-20261001-000001");
    assert.equal(f.page, 2);
    assert.deepEqual(f.sort, { key: "totalApostado", dir: "desc" });
  });
});

describe("buildAdminTicketOrderBy", () => {
  it("default createdAt DESC + id DESC", () => {
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: null, dir: null }),
      ADMIN_TICKET_ORDER_BY_DEFAULT,
    );
    assert.deepEqual(ADMIN_TICKET_ORDER_BY_DEFAULT, [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("cada columna ASC/DESC con desempate id DESC", () => {
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: "numeroVisible", dir: "asc" }),
      [{ numeroVisible: "asc" }, { id: "desc" }],
    );
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: "fechaJuego", dir: "desc" }),
      [{ fechaJuego: "desc" }, { id: "desc" }],
    );
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: "createdAt", dir: "asc" }),
      [{ createdAt: "asc" }, { id: "desc" }],
    );
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: "totalApostado", dir: "desc" }),
      [{ totalApostado: "desc" }, { id: "desc" }],
    );
    assert.deepEqual(
      buildAdminTicketOrderBy({ key: "estado", dir: "asc" }),
      [{ estado: "asc" }, { id: "desc" }],
    );
  });
});

describe("listAdminTickets — orderBy antes de skip/take (mock)", () => {
  it("aplica orderBy tipado y conserva where/skip/take", async () => {
    const findArgs: unknown[] = [];
    const db = {
      ticket: {
        count: async () => 42,
        findMany: async (args: unknown) => {
          findArgs.push(args);
          return [];
        },
      },
      resultado: {
        findMany: async () => [],
      },
    };

    const result = await listAdminTickets(db as never, {
      fecha: "2026-10-01",
      estado: "EMITIDO",
      page: "2",
      pageSize: "10",
      sort: "totalApostado",
      dir: "asc",
    });

    assert.equal(result.total, 42);
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 10);
    assert.equal(findArgs.length, 1);
    const args = findArgs[0] as {
      where: { estado: string };
      orderBy: unknown;
      skip: number;
      take: number;
    };
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
    await listAdminTickets(db as never, {});
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("URL / ciclo UI (contrato)", () => {
  it("cambio de columna reinicia page=1 y preserva filtros", () => {
    let sort = parseAdminListTicketsQuery({
      sort: "createdAt",
      dir: "desc",
    }).sort;
    sort = cycleTableSort(sort, "numeroVisible");
    const href = `/admin/tickets${buildQuery({
      fecha: "2026-10-01",
      estado: "EMITIDO",
      numero: "LJ-1",
      pageSize: "20",
      page: "1",
      sort: sort.key ?? undefined,
      dir: sort.dir ?? undefined,
    })}`;
    assert.match(href, /fecha=2026-10-01/);
    assert.match(href, /estado=EMITIDO/);
    assert.match(href, /numero=LJ-1/);
    assert.match(href, /pageSize=20/);
    assert.match(href, /page=1/);
    assert.match(href, /sort=numeroVisible/);
    assert.match(href, /dir=asc/);
  });

  it("tercer clic elimina sort/dir de la URL", () => {
    let sort = parseAdminListTicketsQuery({
      sort: "estado",
      dir: "asc",
    }).sort;
    sort = cycleTableSort(sort, "estado");
    sort = cycleTableSort(sort, "estado");
    assert.deepEqual(sort, { key: null, dir: null });
    const q = buildQuery({
      fecha: "2026-10-01",
      page: "1",
      sort: sort.key ?? undefined,
      dir: sort.dir ?? undefined,
    });
    assert.equal(q.includes("sort="), false);
    assert.equal(q.includes("dir="), false);
  });
});

describe("contratos de seguridad / alcance", () => {
  it("API admin tickets sigue con requireAdmin y acepta sort/dir", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/api/admin/tickets/route.ts"),
      "utf8",
    );
    assert.match(src, /requireAdmin/);
    assert.match(src, /searchParams\.get\("sort"\)/);
    assert.match(src, /searchParams\.get\("dir"\)/);
  });

  it("listVendorTickets no activa orderBy por sort (alcance fuera de fase)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "lib/tickets/vendor-tickets.ts"),
      "utf8",
    );
    assert.match(src, /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/);
    assert.equal(src.includes("buildAdminTicketOrderBy"), false);
  });
});
