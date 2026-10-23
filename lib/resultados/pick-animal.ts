import { randomInt } from "node:crypto";

export { CATALOGO_ANIMALITOS_ESPERADO } from "@/lib/resultados/catalogo-animalitos-canonico";

/**
 * Índice uniforme en `[0, length)` con CSPRNG (`crypto.randomInt`).
 * No usar `Math.random()` para resultados oficiales.
 */
export function pickUniformIndex(length: number): number {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("pickUniformIndex: length debe ser un entero positivo.");
  }
  return randomInt(length);
}

export function pickRandomAnimalNumero(numeros: readonly string[]): string {
  if (numeros.length === 0) {
    throw new Error("No hay animalitos en el catálogo para el sorteo automático.");
  }
  return numeros[pickUniformIndex(numeros.length)]!;
}
