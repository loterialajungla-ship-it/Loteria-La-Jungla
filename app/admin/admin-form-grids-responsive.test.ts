import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Contrato de grid: columnas minmax(0,1fr) + hijos min-w-0. */
function assertShrinkableGrid(
  src: string,
  opts: {
    colsSm?: 2 | 3;
    colsLg?: 4;
    mustInclude: RegExp[];
  },
) {
  assert.match(src, /\[\&\>\*\]:min-w-0/);
  assert.equal(src.includes("overflow-x-hidden"), false);

  if (opts.colsSm === 2) {
    assert.match(src, /sm:grid-cols-\[repeat\(2,minmax\(0,1fr\)\)\]/);
  }
  if (opts.colsSm === 3) {
    assert.match(src, /sm:grid-cols-\[repeat\(3,minmax\(0,1fr\)\)\]/);
  }
  if (opts.colsLg === 4) {
    assert.match(src, /lg:grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\]/);
  }

  for (const re of opts.mustInclude) {
    assert.match(src, re);
  }
}

describe("admin form grids responsive (D.3.C)", () => {
  it("/admin/tickets: filtro 2 cols contráctil; conserva date/estado/buscar", () => {
    const src = read("app/admin/tickets/page.tsx");
    assertShrinkableGrid(src, {
      colsSm: 2,
      mustInclude: [
        /type="date"/,
        /name="fecha"/,
        /name="estado"/,
        /name="numero"/,
        />\s*Buscar\s*</,
        /method="get"/,
      ],
    });
    // Breakpoint sm conservado (no forzar cols en móvil).
    assert.match(src, /sm:grid-cols-\[repeat\(2/);
    assert.equal(/grid-cols-\[repeat\(2/.test(src.replace(/sm:grid-cols-\[repeat\(2/g, "")), false);
  });

  it("/admin/auditoria: 2→4 cols contráctiles; conserva filtros y botón", () => {
    const src = read("app/admin/auditoria/page.tsx");
    assertShrinkableGrid(src, {
      colsSm: 2,
      colsLg: 4,
      mustInclude: [
        /type="date"/,
        /name="fecha"/,
        /name="accion"/,
        /name="entidad"/,
        />\s*Filtrar\s*</,
        /method="get"/,
        /flex min-w-0 items-end/,
      ],
    });
  });

  it("CreditosConfigForm: date+time en grid 2 cols contráctil", () => {
    const src = read("components/creditos/CreditosConfigForm.tsx");
    assertShrinkableGrid(src, {
      colsSm: 2,
      mustInclude: [/type="date"/, /type="time"/, /Fecha de inicio/, /Hora de inicio/],
    });
  });

  it("Asignar/Retirar créditos: grid 2 cols contráctil; labels intactos", () => {
    const asignar = read("components/creditos/AsignarCreditosForm.tsx");
    const retirar = read("components/creditos/RetirarCreditosForm.tsx");
    assertShrinkableGrid(asignar, {
      colsSm: 2,
      mustInclude: [/name="importeAsignar"/, /name="motivoAsignar"/, /Asignar créditos/],
    });
    assertShrinkableGrid(retirar, {
      colsSm: 2,
      mustInclude: [/name="importeRetirar"/, /name="motivoRetirar"/, /Retirar créditos/],
    });
  });

  it("CorregirCreditosForm: grid 3 cols contráctil; efecto Select conservado", () => {
    const src = read("components/creditos/CorregirCreditosForm.tsx");
    assertShrinkableGrid(src, {
      colsSm: 3,
      mustInclude: [
        /name="importeCorreccion"/,
        /name="efectoCorreccion"/,
        /name="motivoCorreccion"/,
        /Aumentar saldo/,
        /Disminuir saldo/,
      ],
    });
  });
});
