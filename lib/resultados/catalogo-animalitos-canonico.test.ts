import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANIMALES_CANONICOS,
  CATALOGO_ANIMALITOS_ESPERADO,
  CatalogoAnimalitosInvalidoError,
  assertCanonicalAnimalCatalog,
  validateCanonicalAnimalCatalog,
} from "@/lib/resultados/catalogo-animalitos-canonico";

function cloneCanonico() {
  return ANIMALES_CANONICOS.map((a) => ({
    numero: a.numero,
    nombre: a.nombre,
  }));
}

describe("validateCanonicalAnimalCatalog", () => {
  it("acepta el catálogo canónico exacto (38)", () => {
    assert.equal(CATALOGO_ANIMALITOS_ESPERADO, 38);
    assert.equal(ANIMALES_CANONICOS.length, 38);
    const check = validateCanonicalAnimalCatalog(cloneCanonico());
    assert.equal(check.ok, true);
    assert.doesNotThrow(() =>
      assertCanonicalAnimalCatalog(cloneCanonico()),
    );
  });

  it("exige numero 20 = Cerdo (no Cochino)", () => {
    const veinte = ANIMALES_CANONICOS.find((a) => a.numero === "20");
    assert.ok(veinte);
    assert.equal(veinte!.nombre, "Cerdo");
    assert.equal(
      ANIMALES_CANONICOS.some((a) => a.nombre === "Cochino"),
      false,
    );
    const rows = cloneCanonico();
    const idx = rows.findIndex((r) => r.numero === "20");
    rows[idx] = { numero: "20", nombre: "Cochino" };
    const check = validateCanonicalAnimalCatalog(rows);
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "CATALOG_NAME_MISMATCH");
  });

  it("rechaza menos de 38 animales", () => {
    const rows = cloneCanonico().slice(0, 37);
    const check = validateCanonicalAnimalCatalog(rows);
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "CATALOG_SIZE");
    assert.throws(
      () => assertCanonicalAnimalCatalog(rows),
      CatalogoAnimalitosInvalidoError,
    );
  });

  it("rechaza 38 filas con un nombre incorrecto", () => {
    const rows = cloneCanonico();
    const idx = rows.findIndex((r) => r.numero === "10");
    assert.ok(idx >= 0);
    rows[idx] = { numero: "10", nombre: "Animal10" };
    const check = validateCanonicalAnimalCatalog(rows);
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "CATALOG_NAME_MISMATCH");
  });

  it("rechaza número duplicado y otro ausente (sigue habiendo 38 filas)", () => {
    const rows = cloneCanonico();
    const sin01 = rows.filter((r) => r.numero !== "01");
    // 37 canónicos + duplicado de "00" → 38 filas, falta 01
    sin01.push({ numero: "00", nombre: "Ballena" });
    assert.equal(sin01.length, 38);
    const check = validateCanonicalAnimalCatalog(sin01);
    assert.equal(check.ok, false);
    if (!check.ok) assert.equal(check.code, "CATALOG_DUPLICATE");
  });
});
