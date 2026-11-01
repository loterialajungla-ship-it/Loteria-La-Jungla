import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(__dirname, "../..");

function readSrc(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("Admin reportes — filtros y tablas (D.3.F)", () => {
  it("formulario fecha: min-w-0 en flex; Input flex-1; botón shrink-0", () => {
    const src = readSrc("app/admin/reportes/page.tsx");
    assert.match(src, /method="get"/);
    assert.match(src, /name="fecha"/);
    assert.match(src, /type="date"/);
    assert.match(src, /\[&>\*\]:min-w-0/);
    assert.match(src, /containerClassName="min-w-0 flex-1"/);
    assert.match(src, /Ver reporte/);
    assert.match(src, /shrink-0/);
    // contrato funcional intacto
    assert.match(src, /getDailyReport/);
    assert.match(src, /searchParams\.fecha/);
  });

  it("tablas: scroll local max-w-full; exposición con min-w intencional", () => {
    const src = readSrc("app/admin/reportes/page.tsx");
    assert.match(src, /max-w-full overflow-x-auto/);
    assert.match(src, /min-w-\[36rem\]/);
    assert.match(src, /porVendedor/);
    assert.match(src, /exposicion/);
    // no oculta columnas de exposición
    assert.match(src, /Exp\. teórica/);
    assert.match(src, /Mayor exp\./);
  });
});

describe("Admin usuarios — filtros flexibles (D.3.F)", () => {
  it("Selects sin min-w rígido en móvil; conservan sm:min-w-[9rem]", () => {
    const src = readSrc("app/admin/usuarios/page.tsx");
    assert.match(src, /name="activo"/);
    assert.match(src, /name="rol"/);
    assert.match(src, /min-w-0 w-full sm:w-auto sm:min-w-\[9rem\]/);
    assert.doesNotMatch(
      src,
      /containerClassName="min-w-\[9rem\]"/,
    );
    assert.match(src, /\[&>\*\]:min-w-0/);
    assert.match(src, /Filtrar/);
    assert.match(src, /listAdminUsers/);
  });

  it("conserva cards móvil + DataTable escritorio y paginación", () => {
    const src = readSrc("app/admin/usuarios/page.tsx");
    assert.match(src, /lg:hidden/);
    assert.match(src, /hidden lg:block/);
    assert.match(src, /DataTable/);
    assert.match(src, /PaginationBar/);
    assert.match(src, /CreateVendorForm/);
  });
});

describe("Tablas admin — patrón cards/scroll (D.3.F)", () => {
  it("tickets y auditoría mantienen cards móvil y DataTable escritorio", () => {
    const tickets = readSrc("app/admin/tickets/page.tsx");
    const auditoria = readSrc("app/admin/auditoria/page.tsx");
    assert.match(tickets, /md:hidden/);
    assert.match(tickets, /DataTable/);
    assert.match(auditoria, /lg:hidden/);
    assert.match(auditoria, /DataTable/);
    assert.match(auditoria, /overflow-x-auto|DataTable/);
  });

  it("DataTable shell: max-w-full + overflow-x-auto local", () => {
    const src = readSrc("components/ui/DataTable.tsx");
    assert.match(src, /max-w-full/);
    assert.match(src, /overflow-x-auto/);
    assert.match(src, /minWidthClassName/);
  });
});
