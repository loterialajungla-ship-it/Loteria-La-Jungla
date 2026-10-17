import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coincideBusquedaAnimal } from "@/components/tickets/AnimalGrid";

describe("coincideBusquedaAnimal", () => {
  const delfin = { numero: "00", nombre: "Delfín" };
  const ballena = { numero: "0", nombre: "Ballena" };
  const carnero = { numero: "03", nombre: "Carnero" };

  it("sin query muestra todos", () => {
    assert.equal(coincideBusquedaAnimal(delfin, ""), true);
    assert.equal(coincideBusquedaAnimal(delfin, "   "), true);
  });

  it("filtra por número (incluye 0 y 00)", () => {
    assert.equal(coincideBusquedaAnimal(delfin, "00"), true);
    assert.equal(coincideBusquedaAnimal(ballena, "0"), true);
    assert.equal(coincideBusquedaAnimal(carnero, "00"), false);
    assert.equal(coincideBusquedaAnimal(carnero, "03"), true);
  });

  it("filtra por nombre sin distinguir mayúsculas", () => {
    assert.equal(coincideBusquedaAnimal(delfin, "delf"), true);
    assert.equal(coincideBusquedaAnimal(carnero, "CARNE"), true);
    assert.equal(coincideBusquedaAnimal(carnero, "tigre"), false);
  });
});
