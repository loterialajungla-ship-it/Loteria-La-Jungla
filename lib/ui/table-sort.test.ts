import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableRow,
  DataTableTd,
  DataTableTh,
  SortableDataTableTh,
} from "@/components/ui/DataTable";
import {
  ariaSortValue,
  cycleTableSort,
  isSortColumnActive,
  sortIndicatorGlyph,
  type TableSortState,
} from "@/lib/ui/table-sort";
import {
  parseAllowedSortKey,
  parseTableSortDir,
  parseTableSortState,
  resolveOrderByFromMap,
} from "@/lib/ui/table-sort-query";

type Col = "nombre" | "createdAt" | "total";

const emptySort = (): TableSortState<Col> => ({ key: null, dir: null });

describe("cycleTableSort", () => {
  it("ciclo de tres clics (firstDir asc por defecto)", () => {
    let s = emptySort();
    s = cycleTableSort(s, "createdAt");
    assert.deepEqual(s, { key: "createdAt", dir: "asc" });
    s = cycleTableSort(s, "createdAt");
    assert.deepEqual(s, { key: "createdAt", dir: "desc" });
    s = cycleTableSort(s, "createdAt");
    assert.deepEqual(s, { key: null, dir: null });
  });

  it("cambio de columna reinicia en firstDir", () => {
    let s = cycleTableSort(emptySort(), "createdAt");
    s = cycleTableSort(s, "createdAt"); // desc
    s = cycleTableSort(s, "nombre");
    assert.deepEqual(s, { key: "nombre", dir: "asc" });
  });

  it("firstDir configurable (desc → asc → default)", () => {
    let s = emptySort();
    const opts = { firstDir: "desc" as const };
    s = cycleTableSort(s, "total", opts);
    assert.deepEqual(s, { key: "total", dir: "desc" });
    s = cycleTableSort(s, "total", opts);
    assert.deepEqual(s, { key: "total", dir: "asc" });
    s = cycleTableSort(s, "total", opts);
    assert.deepEqual(s, { key: null, dir: null });
  });
});

describe("ariaSortValue / indicator / active", () => {
  it("estado sin ordenación → none y ↕", () => {
    const s = emptySort();
    assert.equal(ariaSortValue("nombre", s), "none");
    assert.equal(sortIndicatorGlyph("nombre", s), "↕");
    assert.equal(isSortColumnActive("nombre", s), false);
  });

  it("ASC y DESC", () => {
    const asc: TableSortState<Col> = { key: "nombre", dir: "asc" };
    const desc: TableSortState<Col> = { key: "nombre", dir: "desc" };
    assert.equal(ariaSortValue("nombre", asc), "ascending");
    assert.equal(ariaSortValue("nombre", desc), "descending");
    assert.equal(sortIndicatorGlyph("nombre", asc), "↑");
    assert.equal(sortIndicatorGlyph("nombre", desc), "↓");
    assert.equal(ariaSortValue("total", asc), "none");
    assert.equal(isSortColumnActive("nombre", asc), true);
  });
});

describe("parseTableSort* (servidor / whitelist)", () => {
  const allowed = ["nombre", "createdAt", "total"] as const;

  it("parseTableSortDir solo asc|desc", () => {
    assert.equal(parseTableSortDir("asc"), "asc");
    assert.equal(parseTableSortDir("DESC"), "desc");
    assert.equal(parseTableSortDir("sideways"), null);
    assert.equal(parseTableSortDir(""), null);
    assert.equal(parseTableSortDir(null), null);
  });

  it("parseAllowedSortKey rechaza campos arbitrarios", () => {
    assert.equal(parseAllowedSortKey("createdAt", allowed), "createdAt");
    assert.equal(parseAllowedSortKey("passwordHash", allowed), null);
    assert.equal(parseAllowedSortKey("createdAt;drop", allowed), null);
  });

  it("parseTableSortState exige key+dir válidos", () => {
    assert.deepEqual(parseTableSortState("createdAt", "asc", allowed), {
      key: "createdAt",
      dir: "asc",
    });
    assert.deepEqual(parseTableSortState("createdAt", "nope", allowed), {
      key: null,
      dir: null,
    });
    assert.deepEqual(parseTableSortState("evil", "asc", allowed), {
      key: null,
      dir: null,
    });
  });

  it("resolveOrderByFromMap usa mapa tipado o fallback", () => {
    type OrderFrag = ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
    const map: Readonly<
      Record<Col, (dir: "asc" | "desc") => OrderFrag>
    > = {
      nombre: (dir) => [{ field: "nombre", dir }],
      createdAt: (dir) => [
        { field: "createdAt", dir },
        { field: "id", dir: "desc" },
      ],
      total: (dir) => [{ field: "totalApostado", dir }],
    };
    const fallback: OrderFrag = [{ field: "createdAt", dir: "desc" }];
    assert.deepEqual(
      resolveOrderByFromMap(
        { key: "createdAt", dir: "asc" },
        map,
        fallback,
      ),
      [
        { field: "createdAt", dir: "asc" },
        { field: "id", dir: "desc" },
      ],
    );
    assert.deepEqual(
      resolveOrderByFromMap(emptySort(), map, fallback),
      fallback,
    );
  });
});

describe("DataTableTh / SortableDataTableTh (markup SSR)", () => {
  it("encabezado normal sin ordenación (sin button ni aria-sort)", () => {
    const html = renderToStaticMarkup(
      createElement(DataTableTh, null, "Nombre"),
    );
    assert.match(html, /<th class="px-3 py-3 font-semibold">Nombre<\/th>/);
    assert.equal(html.includes("<button"), false);
    assert.equal(html.includes("aria-sort"), false);
  });

  it("encabezado ordenable: button type=button, aria-sort, indicador", () => {
    const html = renderToStaticMarkup(
      createElement(
        SortableDataTableTh,
        {
          column: "nombre",
          sort: { key: "nombre", dir: "asc" },
          onSortClick: () => {},
        },
        "Nombre",
      ),
    );
    assert.match(html, /aria-sort="ascending"/);
    assert.match(html, /type="button"/);
    assert.match(html, /min-h-11/);
    assert.match(html, /focus-visible:ring-2/);
    assert.match(html, /↑/);
    assert.equal(html.includes("↕"), false);
  });

  it("sortable inactivo muestra aria-sort=none e indicador ↕", () => {
    const html = renderToStaticMarkup(
      createElement(
        SortableDataTableTh,
        {
          column: "total",
          sort: emptySort(),
          onSortClick: () => {},
        },
        "Total",
      ),
    );
    assert.match(html, /aria-sort="none"/);
    assert.match(html, /↕/);
  });

  it("DESC en columna activa", () => {
    const html = renderToStaticMarkup(
      createElement(
        SortableDataTableTh,
        {
          column: "createdAt",
          sort: { key: "createdAt", dir: "desc" },
          onSortClick: () => {},
        },
        "Creación",
      ),
    );
    assert.match(html, /aria-sort="descending"/);
    assert.match(html, /↓/);
  });

  it("onSortClick recibe la columna (simula activación de botón)", () => {
    const clicks: string[] = [];
    const el = createElement(
      SortableDataTableTh,
      {
        column: "nombre",
        sort: emptySort(),
        onSortClick: (c: string) => {
          clicks.push(c);
        },
      },
      "Nombre",
    );
    const props = el.props as {
      onSortClick: (c: string) => void;
      column: string;
    };
    props.onSortClick(props.column);
    assert.deepEqual(clicks, ["nombre"]);
  });

  it("tabla con DataTableTh estático no introduce botones de sort", () => {
    const html = renderToStaticMarkup(
      createElement(
        DataTable,
        { caption: "Listado de prueba" },
        createElement(
          DataTableHead,
          null,
          createElement(
            "tr",
            null,
            createElement(DataTableTh, null, "A"),
            createElement(DataTableTh, null, "B"),
          ),
        ),
        createElement(
          DataTableBody,
          null,
          createElement(
            DataTableRow,
            null,
            createElement(DataTableTd, null, "1"),
            createElement(DataTableTd, null, "2"),
          ),
        ),
      ),
    );
    assert.match(html, /Listado de prueba/);
    assert.equal(html.includes("<button"), false);
    assert.equal(html.includes("aria-sort"), false);
    assert.match(html, /<th class="px-3 py-3 font-semibold">A<\/th>/);
  });
});
