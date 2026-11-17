import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HORAS_SORTEO, ZONA_HORARIA_VE } from "@/lib/fecha";

describe("HORAS_SORTEO (catálogo canónico)", () => {
  it("contiene exactamente 12 franjas 09:00–20:00", () => {
    assert.equal(HORAS_SORTEO.length, 12);
    assert.deepEqual(
      [...HORAS_SORTEO],
      [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    );
    assert.equal(HORAS_SORTEO[0], 9);
    assert.equal(HORAS_SORTEO[HORAS_SORTEO.length - 1], 20);
  });

  it("está en orden ascendente estricto y sin duplicados", () => {
    for (let i = 1; i < HORAS_SORTEO.length; i++) {
      assert.ok(
        HORAS_SORTEO[i]! > HORAS_SORTEO[i - 1]!,
        `orden roto en índice ${i}`,
      );
    }
    assert.equal(new Set(HORAS_SORTEO).size, HORAS_SORTEO.length);
  });

  it("mantiene America/Caracas como zona autoritativa", () => {
    assert.equal(ZONA_HORARIA_VE, "America/Caracas");
  });
});
