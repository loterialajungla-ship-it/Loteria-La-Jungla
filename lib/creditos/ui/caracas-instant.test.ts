import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  caracasLocalToIsoOffset,
  isoToCaracasLocalParts,
} from "@/lib/creditos/ui/caracas-instant";

describe("caracas-instant", () => {
  it("convierte fecha/hora Caracas a ISO con offset -04:00", () => {
    const iso = caracasLocalToIsoOffset("2026-11-01", "00:00");
    assert.equal(iso, "2026-11-01T00:00:00.000-04:00");
    assert.equal(new Date(iso!).toISOString(), "2026-11-01T04:00:00.000Z");
  });

  it("rechaza entradas inválidas", () => {
    assert.equal(caracasLocalToIsoOffset("01-11-2026", "00:00"), null);
    assert.equal(caracasLocalToIsoOffset("2026-11-01", "25:00"), null);
  });

  it("redondea ISO a partes locales Caracas", () => {
    const parts = isoToCaracasLocalParts("2026-11-01T04:00:00.000Z");
    assert.deepEqual(parts, { fecha: "2026-11-01", hora: "00:00" });
  });
});
