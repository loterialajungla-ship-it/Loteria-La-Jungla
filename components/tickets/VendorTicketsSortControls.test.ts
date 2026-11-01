import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VENDOR_TICKET_SORT_COLUMNS,
  VendorTicketsSortButtons,
  buildVendorTicketsSortHref,
  createVendorTicketsSortClickHandler,
  nextVendorTicketsSortHref,
  type VendorTicketsListParams,
} from "@/components/tickets/VendorTicketsSortControls";
import {
  VENDOR_TICKET_SORT_KEYS,
  type VendorTicketSortKey,
} from "@/lib/tickets/vendor-ticket-sort";
import { cycleTableSort, type TableSortState } from "@/lib/ui/table-sort";

const filters: VendorTicketsListParams = {
  fecha: "2026-10-01",
  estado: "EMITIDO",
  numero: "LJ-1",
  pageSize: "20",
};

const empty = (): TableSortState<VendorTicketSortKey> => ({
  key: null,
  dir: null,
});

function noDupes(href: string) {
  const q = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  const keys = q
    .split("&")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p.split("=")[0]!));
  assert.equal(keys.length, new Set(keys).size, `dupes in ${href}`);
}

describe("VENDOR_TICKET_SORT_COLUMNS", () => {
  it("cubre las cinco claves del servidor", () => {
    assert.deepEqual(
      VENDOR_TICKET_SORT_COLUMNS.map((c) => c.key),
      [...VENDOR_TICKET_SORT_KEYS],
    );
  });
});

describe("ciclo ASC → DESC → default (cinco columnas)", () => {
  for (const { key, label } of VENDOR_TICKET_SORT_COLUMNS) {
    it(`${label} (${key})`, () => {
      let sort = empty();
      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key, dir: "asc" });
      const asc = nextVendorTicketsSortHref(filters, empty(), key);
      noDupes(asc);
      assert.match(asc, new RegExp(`sort=${key}`));
      assert.match(asc, /dir=asc/);
      assert.match(asc, /page=1/);

      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key, dir: "desc" });
      const desc = nextVendorTicketsSortHref(
        filters,
        { key, dir: "asc" },
        key,
      );
      noDupes(desc);
      assert.match(desc, /dir=desc/);

      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key: null, dir: null });
      const def = nextVendorTicketsSortHref(
        filters,
        { key, dir: "desc" },
        key,
      );
      noDupes(def);
      assert.equal(def.includes("sort="), false);
      assert.equal(def.includes("dir="), false);
      assert.match(def, /fecha=2026-10-01/);
      assert.match(def, /estado=EMITIDO/);
      assert.match(def, /numero=LJ-1/);
      assert.match(def, /pageSize=20/);
      assert.match(def, /page=1/);
    });
  }
});

describe("cambio de columna / conservación", () => {
  it("otra columna → ASC, page=1, filtros intactos", () => {
    const href = nextVendorTicketsSortHref(
      filters,
      { key: "createdAt", dir: "desc" },
      "numeroVisible",
    );
    noDupes(href);
    assert.match(href, /sort=numeroVisible/);
    assert.match(href, /dir=asc/);
    assert.match(href, /page=1/);
    assert.match(href, /pageSize=20/);
  });

  it("predeterminado elimina sort/dir", () => {
    const href = buildVendorTicketsSortHref(filters, {
      key: null,
      dir: null,
    });
    assert.equal(href.includes("sort="), false);
    assert.equal(href.includes("dir="), false);
  });
});

describe("handler compartido móvil/escritorio", () => {
  it("mismo navigate para la misma transición", () => {
    const sort: TableSortState<VendorTicketSortKey> = {
      key: "fechaJuego",
      dir: "asc",
    };
    const a: string[] = [];
    const b: string[] = [];
    createVendorTicketsSortClickHandler(filters, sort, (h) => a.push(h))(
      "fechaJuego",
    );
    createVendorTicketsSortClickHandler(filters, sort, (h) => b.push(h))(
      "fechaJuego",
    );
    assert.deepEqual(a, b);
    assert.equal(a[0], nextVendorTicketsSortHref(filters, sort, "fechaJuego"));
  });
});

describe("VendorTicketsSortButtons — a11y", () => {
  it("botones 44px, aria-label, aria-pressed, sin select ni roles de tabla", () => {
    const html = renderToStaticMarkup(
      createElement(VendorTicketsSortButtons, {
        sort: { key: "estado", dir: "asc" },
        onSortClick: () => {},
      }),
    );
    assert.match(html, /data-testid="vendor-tickets-sort"/);
    assert.match(html, /role="group"/);
    assert.match(html, /aria-label="Ordenar tickets"/);
    assert.match(
      html,
      /aria-label="Estado, orden ascendente\. Pulsar para descendente"/,
    );
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /min-h-\[44px\]/);
    assert.match(html, /min-w-\[44px\]/);
    assert.match(html, /focus-visible:ring-2/);
    assert.match(html, /↑/);
    assert.equal(html.includes("role=\"columnheader\""), false);
    assert.equal(html.includes("aria-sort"), false);
    assert.equal(html.includes("<select"), false);
  });
});

describe("página venta tickets — controles de sort", () => {
  it("page.tsx usa VendorTicketsSortBar y conserva filtros", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/venta/tickets/page.tsx"),
      "utf8",
    );
    assert.match(src, /VendorTicketsSortBar/);
    assert.match(src, /sortState/);
    assert.equal(src.includes('label="Ordenar por"'), false);
    assert.equal(src.includes("Aplicar orden"), false);
  });
});
