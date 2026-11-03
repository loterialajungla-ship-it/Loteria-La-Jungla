import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import { getAnimalsWithMinimumExposure } from "@/lib/resultados/min-exposure-selection";
import type { AnimalExposicion } from "@/lib/tickets/aggregate-exposure";
import { pickRandomAnimalNumero } from "@/lib/resultados/pick-animal";

function row(
  partial: Pick<AnimalExposicion, "numeroAnimal" | "exposicion"> &
    Partial<AnimalExposicion>,
): AnimalExposicion {
  return {
    nombreAnimal: partial.nombreAnimal ?? `A${partial.numeroAnimal}`,
    totalApostado: partial.totalApostado ?? "0.00",
    ticketsAfectados: partial.ticketsAfectados ?? 0,
    numeroAnimal: partial.numeroAnimal,
    exposicion: partial.exposicion,
  };
}

describe("getAnimalsWithMinimumExposure", () => {
  it("un único animal con exposición mínima", () => {
    const r = getAnimalsWithMinimumExposure([
      row({ numeroAnimal: "03", exposicion: "100.00" }),
      row({ numeroAnimal: "05", exposicion: "10.00" }),
      row({ numeroAnimal: "12", exposicion: "50.00" }),
    ]);
    assert.equal(r.exposicionMinima, "10.00");
    assert.deepEqual(r.numeros, ["05"]);
  });

  it("varios animales empatados en el mínimo", () => {
    const r = getAnimalsWithMinimumExposure([
      row({ numeroAnimal: "03", exposicion: "300.00" }),
      row({ numeroAnimal: "05", exposicion: "120.00" }),
      row({ numeroAnimal: "12", exposicion: "120.00" }),
      row({ numeroAnimal: "20", exposicion: "900.00" }),
    ]);
    assert.equal(r.exposicionMinima, "120.00");
    assert.deepEqual(r.numeros, ["05", "12"]);
  });

  it("todos con exposición cero → todos elegibles", () => {
    const animales = ANIMALES_CANONICOS.map((a) =>
      row({
        numeroAnimal: a.numero,
        nombreAnimal: a.nombre,
        exposicion: "0.00",
      }),
    );
    assert.equal(animales.length, 38);
    const r = getAnimalsWithMinimumExposure(animales);
    assert.equal(r.exposicionMinima, "0.00");
    assert.equal(r.numeros.length, 38);
    assert.deepEqual(
      r.numeros,
      ANIMALES_CANONICOS.map((a) => a.numero),
    );
  });

  it("todos con la misma exposición positiva → todos elegibles", () => {
    const animales = ANIMALES_CANONICOS.map((a) =>
      row({
        numeroAnimal: a.numero,
        nombreAnimal: a.nombre,
        exposicion: "45.00",
      }),
    );
    const r = getAnimalsWithMinimumExposure(animales);
    assert.equal(r.exposicionMinima, "45.00");
    assert.equal(r.numeros.length, 38);
  });

  it("comparación Decimal exacta (no lexicográfica 9 vs 10)", () => {
    const r = getAnimalsWithMinimumExposure([
      row({ numeroAnimal: "01", exposicion: "10.00" }),
      row({ numeroAnimal: "02", exposicion: "9.00" }),
      row({ numeroAnimal: "03", exposicion: "100.00" }),
    ]);
    assert.equal(r.exposicionMinima, "9.00");
    assert.deepEqual(r.numeros, ["02"]);
  });

  it("valores 9.00 y 10.00: el mínimo es 9.00", () => {
    const r = getAnimalsWithMinimumExposure([
      row({ numeroAnimal: "10", exposicion: "10.00" }),
      row({ numeroAnimal: "09", exposicion: "9.00" }),
    ]);
    assert.deepEqual(r.numeros, ["09"]);
  });

  it("pickRandomAnimalNumero solo elige del conjunto mínimo", () => {
    const elegibles = ["05", "12", "20"];
    const animales = [
      row({ numeroAnimal: "03", exposicion: "500.00" }),
      row({ numeroAnimal: "05", exposicion: "10.00" }),
      row({ numeroAnimal: "12", exposicion: "10.00" }),
      row({ numeroAnimal: "20", exposicion: "10.00" }),
      row({ numeroAnimal: "36", exposicion: "999.00" }),
    ];
    const r = getAnimalsWithMinimumExposure(animales);
    assert.deepEqual(r.numeros, elegibles);
    for (let i = 0; i < 40; i++) {
      const n = pickRandomAnimalNumero(r.numeros);
      assert.ok(elegibles.includes(n));
      assert.ok(!["03", "36"].includes(n));
    }
  });

  it("catálogo completo de 38: mínimo parcial deja solo ceros", () => {
    const animales = ANIMALES_CANONICOS.map((a) =>
      row({
        numeroAnimal: a.numero,
        nombreAnimal: a.nombre,
        exposicion:
          a.numero === "03" || a.numero === "05" ? "150.00" : "0.00",
      }),
    );
    const r = getAnimalsWithMinimumExposure(animales);
    assert.equal(r.exposicionMinima, "0.00");
    assert.equal(r.numeros.length, 36);
    assert.ok(!r.numeros.includes("03"));
    assert.ok(!r.numeros.includes("05"));
  });

  it("rechaza lista vacía", () => {
    assert.throws(() => getAnimalsWithMinimumExposure([]));
  });
});
