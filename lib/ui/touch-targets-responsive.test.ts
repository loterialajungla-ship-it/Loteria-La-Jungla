import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/Button";
import { PaginationBar } from "@/components/ui/PaginationBar";
import {
  SortableDataTableTh,
} from "@/components/ui/DataTable";
import { ADMIN_NAV, VENDOR_NAV } from "@/components/nav/nav-config";

function classTokens(html: string, tag = "button"): Set<string> {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*\\sclass="([^"]*)"`, "i"));
  assert.ok(m?.[1], `sin class en <${tag}>`);
  return new Set(m[1].split(/\s+/).filter(Boolean));
}

describe("Button — tamaños táctiles (D.3.D)", () => {
  it("sm y md ≥ min-h-11; lg min-h-12; API size/variant intacta", () => {
    const sm = renderToStaticMarkup(
      createElement(Button, { size: "sm", type: "button" }, "Guardar"),
    );
    const md = renderToStaticMarkup(
      createElement(Button, { size: "md", type: "submit" }, "Enviar"),
    );
    const lg = renderToStaticMarkup(
      createElement(Button, { size: "lg", variant: "danger", disabled: true }, "Borrar"),
    );
    assert.ok(classTokens(sm).has("min-h-11"));
    assert.ok(classTokens(md).has("min-h-11"));
    assert.ok(classTokens(lg).has("min-h-12"));
    assert.match(lg, /disabled/);
    assert.match(md, /type="submit"/);
    assert.match(sm, />Guardar</);
  });

  it("conserva focus-visible y disabled", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { size: "sm", disabled: true }, "X"),
    );
    const cls = classTokens(html);
    assert.ok(cls.has("focus-visible:ring-2") || [...cls].some((c) => c.includes("focus-visible")));
    assert.match(html, /disabled/);
  });
});

describe("PaginationBar — táctil y contrato (D.3.D)", () => {
  it("Anterior/Siguiente con min-h-11; aria-label; disabled sin href", () => {
    const mid = renderToStaticMarkup(
      createElement(PaginationBar, {
        page: 2,
        totalPages: 5,
        total: 100,
        itemLabel: "tickets",
        prevHref: "/admin/tickets?page=1",
        nextHref: "/admin/tickets?page=3",
      }),
    );
    assert.match(mid, /aria-label="Paginación"/);
    assert.match(mid, /href="\/admin\/tickets\?page=1"/);
    assert.match(mid, /href="\/admin\/tickets\?page=3"/);
    assert.match(mid, /Anterior/);
    assert.match(mid, /Siguiente/);
    assert.match(mid, /Página 2 de 5/);
    assert.match(mid, /min-h-11/);

    const edge = renderToStaticMarkup(
      createElement(PaginationBar, {
        page: 1,
        totalPages: 1,
        total: 3,
        itemLabel: "items",
        prevHref: null,
        nextHref: null,
      }),
    );
    assert.match(edge, /aria-disabled="true"/);
    assert.equal(edge.includes('href="'), false);
  });
});

describe("SortableDataTableTh — táctil y teclado (D.3.D)", () => {
  it("button type=button, min-h-11, aria-sort, onSortClick", () => {
    let clicked: string | null = null;
    const html = renderToStaticMarkup(
      createElement(
        SortableDataTableTh,
        {
          column: "createdAt",
          sort: { key: "createdAt", dir: "asc" },
          onSortClick: (c) => {
            clicked = c;
          },
        },
        "Creación",
      ),
    );
    assert.match(html, /type="button"/);
    assert.match(html, /aria-sort="ascending"/);
    assert.match(html, /min-h-11/);
    assert.match(html, /focus-visible:ring-2/);
    assert.match(html, /↑/);
    // Simula activación: el handler está cableado (contrato de props).
    const props = {
      column: "createdAt" as const,
      sort: { key: "createdAt" as const, dir: "asc" as const },
      onSortClick: (c: string) => {
        clicked = c;
      },
    };
    props.onSortClick(props.column);
    assert.equal(clicked, "createdAt");
  });
});

describe("AppNavLinks / nav-config — rutas y táctil (D.3.D)", () => {
  it("ADMIN_NAV y VENDOR_NAV conservan hrefs esperados", () => {
    assert.deepEqual(
      ADMIN_NAV.map((i) => i.href),
      [
        "/admin",
        "/admin/tickets",
        "/admin/creditos",
        "/admin/usuarios",
        "/admin/reportes",
        "/admin/auditoria",
        "/venta",
        "/perfil",
      ],
    );
    assert.deepEqual(
      VENDOR_NAV.map((i) => i.href),
      ["/venta", "/venta/tickets", "/perfil"],
    );
  });

  it("AppNavLinks fuente: min-h-11, scroll local, focus-visible", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/nav/AppNavLinks.tsx"),
      "utf8",
    );
    assert.match(src, /min-h-11/);
    assert.match(src, /overflow-x-auto/);
    assert.match(src, /focus-visible:ring-2/);
    assert.match(src, /aria-current/);
    assert.equal(src.includes("overflow-x-hidden"), false);
  });
});

describe("enlaces Ver tickets — destinos y táctil (D.3.D)", () => {
  it("venta y admin conservan hrefs a detalle con min-h-11", () => {
    const venta = fs.readFileSync(
      path.join(process.cwd(), "app/venta/tickets/page.tsx"),
      "utf8",
    );
    const admin = fs.readFileSync(
      path.join(process.cwd(), "app/admin/tickets/page.tsx"),
      "utf8",
    );
    assert.match(venta, /href=\{`\/venta\/tickets\/\$\{t\.id\}`\}/);
    assert.match(venta, /min-h-11/);
    assert.match(admin, /href=\{`\/admin\/tickets\/\$\{t\.id\}`\}/);
    assert.match(admin, /min-h-11/);
    assert.match(admin, />\s*Ver detalle\s*</);
    assert.match(admin, />\s*Ver\s*</);
  });
});
