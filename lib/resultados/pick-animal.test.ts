import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOGO_ANIMALITOS_ESPERADO,
  pickRandomAnimalNumero,
  pickUniformIndex,
} from "@/lib/resultados/pick-animal";

const CATALOGO_38 = [
  "0",
  "00",
  ...Array.from({ length: 36 }, (_, i) => String(i + 1).padStart(2, "0")),
] as const;

describe("pick-animal", () => {
  it("catálogo esperado es 38", () => {
    assert.equal(CATALOGO_ANIMALITOS_ESPERADO, 38);
    assert.equal(CATALOGO_38.length, 38);
  });

  it("pickUniformIndex está en rango y rechaza length inválido", () => {
    for (let i = 0; i < 40; i++) {
      const idx = pickUniformIndex(38);
      assert.ok(idx >= 0 && idx < 38);
    }
    assert.throws(() => pickUniformIndex(0));
    assert.throws(() => pickUniformIndex(-1));
  });

  it("pickRandomAnimalNumero solo devuelve del catálogo", () => {
    for (let i = 0; i < 50; i++) {
      const n = pickRandomAnimalNumero(CATALOGO_38);
      assert.ok((CATALOGO_38 as readonly string[]).includes(n));
    }
    assert.throws(() => pickRandomAnimalNumero([]));
  });
});
