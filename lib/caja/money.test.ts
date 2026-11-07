import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { CajaValidationError } from "@/lib/caja/errors";
import {
  calcularSplitComision,
  moneyFixed2,
  parseImporteCajaNoNegativo,
  parsePorcentajeComision,
  roundHalfUp2,
  toCajaDecimal,
} from "@/lib/caja/money";

describe("caja/money — Decimal y ROUND_HALF_UP", () => {
  it("roundHalfUp2: mitades positivas hacia arriba", () => {
    assert.equal(moneyFixed2(roundHalfUp2(new Prisma.Decimal("1.225"))), "1.23");
    assert.equal(moneyFixed2(roundHalfUp2(new Prisma.Decimal("1.235"))), "1.24");
    assert.equal(moneyFixed2(roundHalfUp2(new Prisma.Decimal("2.5"))), "2.50");
  });

  it("calcularSplitComision 20 %: identidad bruto = comisión + admin", () => {
    const s = calcularSplitComision("100.00", "20");
    assert.equal(moneyFixed2(s.comisionImporte), "20.00");
    assert.equal(moneyFixed2(s.importeAdmin), "80.00");
    assert.ok(s.comisionImporte.plus(s.importeAdmin).eq(s.bruto));
  });

  it("0 % y 100 %", () => {
    const z = calcularSplitComision("50.00", "0");
    assert.equal(moneyFixed2(z.comisionImporte), "0.00");
    assert.equal(moneyFixed2(z.importeAdmin), "50.00");

    const f = calcularSplitComision("50.00", "100");
    assert.equal(moneyFixed2(f.comisionImporte), "50.00");
    assert.equal(moneyFixed2(f.importeAdmin), "0.00");
  });

  it("importes pequeños y half-up en comisión", () => {
    // 0.05 * 20% = 0.01 exacto
    const a = calcularSplitComision("0.05", "20");
    assert.equal(moneyFixed2(a.comisionImporte), "0.01");
    assert.equal(moneyFixed2(a.importeAdmin), "0.04");
    assert.ok(a.comisionImporte.plus(a.importeAdmin).eq(a.bruto));

    // 0.03 * 20% = 0.006 → 0.01 half-up
    const b = calcularSplitComision("0.03", "20");
    assert.equal(moneyFixed2(b.comisionImporte), "0.01");
    assert.equal(moneyFixed2(b.importeAdmin), "0.02");
    assert.ok(b.comisionImporte.plus(b.importeAdmin).eq(b.bruto));
  });

  it("decimales exactos sin float", () => {
    const s = calcularSplitComision("10.10", "20.00");
    assert.equal(moneyFixed2(s.comisionImporte), "2.02");
    assert.equal(moneyFixed2(s.importeAdmin), "8.08");
  });

  it("rechaza valores inválidos", () => {
    assert.throws(() => toCajaDecimal("1.234"), CajaValidationError);
    assert.throws(() => toCajaDecimal(-1), CajaValidationError);
    assert.throws(() => parseImporteCajaNoNegativo("-0.01"), CajaValidationError);
    assert.throws(() => parsePorcentajeComision("100.01"), CajaValidationError);
    assert.throws(() => parsePorcentajeComision("-1"), CajaValidationError);
    assert.throws(() => parsePorcentajeComision("12.345"), CajaValidationError);
  });
});
