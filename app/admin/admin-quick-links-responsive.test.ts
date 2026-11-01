import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const EXPECTED_HREFS = [
  "/admin/tickets",
  "/admin/reportes",
  "/admin/creditos",
  "/admin/usuarios",
  "/admin/auditoria",
  "/venta",
] as const;

function classTokens(cls: string): Set<string> {
  return new Set(cls.split(/\s+/).filter(Boolean));
}

/** Extrae el literal de quickLinkClass sin importar la page (evita Prisma / exports Next). */
function readQuickLinkClass(src: string): string {
  const m = src.match(/const quickLinkClass\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(m?.[1], "quickLinkClass no encontrado");
  return m[1];
}

describe("Admin quick links — táctil (D.3.H / G-01)", () => {
  const src = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");

  it("contrato quickLinkClass: min-h-11 y focus; sin min-h-10", () => {
    const tokens = classTokens(readQuickLinkClass(src));
    assert.ok(tokens.has("min-h-11"), "debe usar min-h-11 (~44px)");
    assert.equal(tokens.has("min-h-10"), false);
    assert.ok(tokens.has("inline-flex"));
    assert.ok(
      [...tokens].some((t) => t.startsWith("focus-visible:ring")),
      "focus-visible ring presente",
    );
  });

  it("conserva destinos de accesos rápidos y aria-label", () => {
    assert.match(src, /aria-label="Accesos rápidos"/);
    for (const href of EXPECTED_HREFS) {
      assert.ok(src.includes(`href="${href}"`), `falta destino ${href}`);
    }
    assert.match(src, /Ir al primer pendiente/);
    assert.match(src, /className=\{quickLinkClass\}/);
    assert.doesNotMatch(src, /min-h-10/);
  });
});
