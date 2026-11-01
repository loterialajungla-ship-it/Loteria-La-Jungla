import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ADMIN_TICKET_SORT_COLUMNS,
  AdminTicketsMobileSortButtons,
  buildAdminTicketsSortHref,
  createAdminTicketsSortClickHandler,
  nextAdminTicketsSortHref,
  type AdminTicketsListParams,
} from "@/components/tickets/AdminTicketsSortControls";
import { SortableDataTableTh } from "@/components/ui/DataTable";
import {
  ADMIN_TICKET_SORT_KEYS,
  buildAdminTicketOrderBy,
  type AdminTicketSortKey,
} from "@/lib/tickets/admin-ticket-sort";
import { cycleTableSort, type TableSortState } from "@/lib/ui/table-sort";

const filters: AdminTicketsListParams = {
  fecha: "2026-10-01",
  estado: "EMITIDO",
  numero: "LJ-20261001-000001",
  pageSize: "20",
};

const empty = (): TableSortState<AdminTicketSortKey> => ({
  key: null,
  dir: null,
});

describe("ADMIN_TICKET_SORT_COLUMNS", () => {
  it("cubre exactamente las cinco claves del servidor", () => {
    assert.deepEqual(
      ADMIN_TICKET_SORT_COLUMNS.map((c) => c.key),
      [...ADMIN_TICKET_SORT_KEYS],
    );
    assert.deepEqual(
      ADMIN_TICKET_SORT_COLUMNS.map((c) => c.label),
      ["Número", "Fecha", "Creación", "Total", "Estado"],
    );
  });
});

describe("ciclo ASC → DESC → default (cinco columnas)", () => {
  for (const { key, label } of ADMIN_TICKET_SORT_COLUMNS) {
    it(`${label} (${key})`, () => {
      let sort = empty();
      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key, dir: "asc" });
      assert.equal(
        nextAdminTicketsSortHref(filters, empty(), key),
        buildAdminTicketsSortHref(filters, { key, dir: "asc" }),
      );

      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key, dir: "desc" });
      assert.equal(
        nextAdminTicketsSortHref(filters, { key, dir: "asc" }, key),
        buildAdminTicketsSortHref(filters, { key, dir: "desc" }),
      );

      sort = cycleTableSort(sort, key);
      assert.deepEqual(sort, { key: null, dir: null });
      const href = nextAdminTicketsSortHref(
        filters,
        { key, dir: "desc" },
        key,
      );
      assert.equal(href.includes("sort="), false);
      assert.equal(href.includes("dir="), false);
      assert.match(href, /page=1/);
    });
  }
});

describe("filtros, pageSize y page=1", () => {
  it("cambio de columna → firstDir asc, page=1, filtros intactos", () => {
    const href = nextAdminTicketsSortHref(
      filters,
      { key: "createdAt", dir: "desc" },
      "numeroVisible",
    );
    assert.match(href, /sort=numeroVisible/);
    assert.match(href, /dir=asc/);
    assert.match(href, /page=1/);
    assert.match(href, /fecha=2026-10-01/);
    assert.match(href, /estado=EMITIDO/);
    assert.match(href, /numero=LJ-20261001-000001/);
    assert.match(href, /pageSize=20/);
  });

  it("predeterminado elimina sort/dir y conserva filtros", () => {
    const href = buildAdminTicketsSortHref(filters, { key: null, dir: null });
    assert.equal(href.includes("sort="), false);
    assert.equal(href.includes("dir="), false);
    assert.match(href, /fecha=2026-10-01/);
    assert.match(href, /pageSize=20/);
    assert.match(href, /page=1/);
  });
});

describe("handler compartido (wiring escritorio / móvil sin Next)", () => {
  it("escritorio: SortableDataTableTh + handler → nextAdminTicketsSortHref", () => {
    const navigated: string[] = [];
    const sort: TableSortState<AdminTicketSortKey> = {
      key: "fechaJuego",
      dir: "asc",
    };
    const onSortClick = createAdminTicketsSortClickHandler(
      filters,
      sort,
      (href) => {
        navigated.push(href);
      },
    );

    const el = createElement(
      SortableDataTableTh,
      {
        column: "fechaJuego",
        sort,
        onSortClick: (column: string) => {
          onSortClick(column as AdminTicketSortKey);
        },
      },
      "Fecha",
    );
    const props = el.props as {
      onSortClick: (c: string) => void;
      column: string;
    };
    props.onSortClick(props.column);

    assert.equal(navigated.length, 1);
    assert.equal(
      navigated[0],
      nextAdminTicketsSortHref(filters, sort, "fechaJuego"),
    );
    assert.match(navigated[0]!, /dir=desc/);
    assert.match(navigated[0]!, /page=1/);
  });

  it("móvil: MobileSortButtons + mismo handler → mismo href", () => {
    const navigated: string[] = [];
    const sort: TableSortState<AdminTicketSortKey> = {
      key: "totalApostado",
      dir: "desc",
    };
    const onSortClick = createAdminTicketsSortClickHandler(
      filters,
      sort,
      (href) => {
        navigated.push(href);
      },
    );

    onSortClick("totalApostado");
    assert.equal(
      navigated[0],
      nextAdminTicketsSortHref(filters, sort, "totalApostado"),
    );
    assert.equal(navigated[0]!.includes("sort="), false);
    assert.equal(navigated[0]!.includes("dir="), false);

    // El presentacional móvil recibe exactamente ese handler.
    const clicks: AdminTicketSortKey[] = [];
    const html = renderToStaticMarkup(
      createElement(AdminTicketsMobileSortButtons, {
        sort,
        onSortClick: (column) => {
          clicks.push(column);
          onSortClick(column);
        },
      }),
    );
    assert.match(html, /data-testid="admin-tickets-mobile-sort"/);
    assert.equal(html.includes("role=\"columnheader\""), false);
    assert.equal(html.includes("aria-sort"), false);

    // Simula el onClick que el botón invocaría con la columna Estado (cambio).
    const wired = createAdminTicketsSortClickHandler(
      filters,
      sort,
      (href) => {
        navigated.push(href);
      },
    );
    wired("estado");
    assert.equal(
      navigated[1],
      nextAdminTicketsSortHref(filters, sort, "estado"),
    );
    assert.match(navigated[1]!, /sort=estado/);
    assert.match(navigated[1]!, /dir=asc/);
  });

  it("Head y MobileSortBar comparten createAdminTicketsSortClickHandler", () => {
    // Sin montar useRouter: ambos wrappers deben construir el handler con la
    // misma fábrica (única vía comprobable sin Next). Verificación estructural
    // mínima: la fábrica es la API exportada que ambos deben usar.
    const desktopNav: string[] = [];
    const mobileNav: string[] = [];
    const sort = empty();
    const desktop = createAdminTicketsSortClickHandler(
      filters,
      sort,
      (h) => desktopNav.push(h),
    );
    const mobile = createAdminTicketsSortClickHandler(
      filters,
      sort,
      (h) => mobileNav.push(h),
    );
    desktop("createdAt");
    mobile("createdAt");
    assert.deepEqual(desktopNav, mobileNav);
    assert.equal(
      desktopNav[0],
      nextAdminTicketsSortHref(filters, sort, "createdAt"),
    );

    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        "components/tickets/AdminTicketsSortControls.tsx",
      ),
      "utf8",
    );
    // Ambos wrappers delegan en la fábrica (no reimplementan cycle in-line).
    const headIdx = src.indexOf("export function AdminTicketsSortableHead");
    const barIdx = src.indexOf("export function AdminTicketsMobileSortBar");
    assert.ok(headIdx >= 0 && barIdx > headIdx);
    assert.match(
      src.slice(headIdx, barIdx),
      /createAdminTicketsSortClickHandler/,
    );
    assert.match(
      src.slice(barIdx),
      /createAdminTicketsSortClickHandler/,
    );
  });
});

describe("AdminTicketsMobileSortButtons — a11y (sin roles de tabla)", () => {
  it("botones nativos: aria-label con dirección, aria-pressed, 44px, glifos", () => {
    const html = renderToStaticMarkup(
      createElement(AdminTicketsMobileSortButtons, {
        sort: { key: "estado", dir: "asc" },
        onSortClick: () => {},
      }),
    );
    assert.match(html, /role="group"/);
    assert.match(html, /aria-label="Ordenar tickets"/);
    assert.match(
      html,
      /aria-label="Estado, orden ascendente\. Pulsar para descendente"/,
    );
    assert.match(
      html,
      /aria-label="Número, sin orden activo\. Pulsar para ascendente"/,
    );
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /min-h-\[44px\]/);
    assert.match(html, /min-w-\[44px\]/);
    assert.match(html, /focus-visible:ring-2/);
    assert.match(html, /↑/);
    assert.match(html, /↕/);
    assert.equal(html.includes("role=\"columnheader\""), false);
    assert.equal(html.includes("aria-sort"), false);
    assert.equal(html.includes("<select"), false);
    assert.equal(html.includes("Ordenar por"), false);
    assert.equal(html.includes("Aplicar orden"), false);
  });

  it("escritorio SortableDataTableTh conserva aria-sort de tabla", () => {
    const html = renderToStaticMarkup(
      createElement(
        SortableDataTableTh,
        {
          column: "numeroVisible" as AdminTicketSortKey,
          sort: { key: "numeroVisible", dir: "desc" },
          onSortClick: () => {},
        },
        "Número",
      ),
    );
    assert.match(html, /aria-sort="descending"/);
    assert.match(html, /↓/);
    assert.match(html, /min-h-10/);
  });
});

describe("página admin tickets — sin selectores móviles", () => {
  it("page.tsx usa MobileSortBar y no formulario select de orden", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/admin/tickets/page.tsx"),
      "utf8",
    );
    assert.match(src, /AdminTicketsMobileSortBar/);
    assert.match(src, /AdminTicketsSortableHead/);
    assert.equal(src.includes('label="Ordenar por"'), false);
    assert.equal(src.includes("Aplicar orden"), false);
    assert.equal(src.includes('label="Dirección"'), false);
    assert.equal(src.includes('Predeterminado (creación'), false);
  });
});

describe("sin regresión de ordenación en servidor", () => {
  it("buildAdminTicketOrderBy intacto para las cinco columnas", () => {
    for (const key of ADMIN_TICKET_SORT_KEYS) {
      assert.deepEqual(buildAdminTicketOrderBy({ key, dir: "asc" }), [
        { [key]: "asc" },
        { id: "desc" },
      ]);
      assert.deepEqual(buildAdminTicketOrderBy({ key, dir: "desc" }), [
        { [key]: "desc" },
        { id: "desc" },
      ]);
    }
    assert.deepEqual(buildAdminTicketOrderBy({ key: null, dir: null }), [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});
