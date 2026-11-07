import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCajaMoney,
  formatCajaPct,
  newCajaIdempotencyKey,
} from "@/lib/caja/ui/format";

describe("caja/ui format", () => {
  it("formatea importes con 2 decimales", () => {
    assert.match(formatCajaMoney("1234.50"), /1\.234,50|1234/);
    assert.equal(formatCajaMoney(null), "—");
  });

  it("formatea porcentaje", () => {
    assert.equal(formatCajaPct("20.00"), "20.00 %");
    assert.equal(formatCajaPct(null), "—");
  });

  it("idempotency key no vacía", () => {
    const a = newCajaIdempotencyKey();
    const b = newCajaIdempotencyKey();
    assert.ok(a.length > 8);
    assert.notEqual(a, b);
  });
});
