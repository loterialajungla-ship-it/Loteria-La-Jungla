import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  importeMayorQue,
  isImporteCreditoValido,
  parseImporteToCents,
} from "@/lib/creditos/ui/money-input";

describe("money-input UI", () => {
  it("acepta decimales válidos y rechaza inválidos", () => {
    assert.equal(parseImporteToCents("10.50"), 1050);
    assert.equal(isImporteCreditoValido("0.01"), true);
    assert.equal(isImporteCreditoValido("0"), false);
    assert.equal(isImporteCreditoValido("1.001"), false);
    assert.equal(isImporteCreditoValido("10.5"), true);
    assert.equal(isImporteCreditoValido("abc"), false);
  });

  it("compara importes sin float", () => {
    assert.equal(importeMayorQue("10.01", "10.00"), true);
    assert.equal(importeMayorQue("9.99", "10.00"), false);
  });
});
