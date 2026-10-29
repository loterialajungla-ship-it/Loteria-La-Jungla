import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";
import { fingerprintOperacionCredito } from "@/lib/creditos/ui/idempotency";

describe("submit-guard", () => {
  it("bloquea un segundo acquire hasta release", () => {
    const g = createSubmitGuard();
    assert.equal(g.tryAcquire(), true);
    assert.equal(g.tryAcquire(), false);
    g.release();
    assert.equal(g.tryAcquire(), true);
  });
});

describe("fingerprintOperacionCredito", () => {
  it("cambia al alterar importe o motivo", () => {
    const a = fingerprintOperacionCredito({
      tipo: "ASIGNAR",
      vendedorId: "v1",
      importe: "10.00",
      motivo: "a",
    });
    const b = fingerprintOperacionCredito({
      tipo: "ASIGNAR",
      vendedorId: "v1",
      importe: "10.01",
      motivo: "a",
    });
    const c = fingerprintOperacionCredito({
      tipo: "ASIGNAR",
      vendedorId: "v1",
      importe: "10.00",
      motivo: "b",
    });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});
