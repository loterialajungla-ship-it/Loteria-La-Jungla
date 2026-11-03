import { Prisma } from "@prisma/client";
import type { AnimalExposicion } from "@/lib/tickets/aggregate-exposure";

export type MinExposureSelection = {
  /** Exposición mínima en formato fijo a 2 decimales (misma convención que aggregateExposure). */
  exposicionMinima: string;
  /** Números de animales empatados en el mínimo (orden del catálogo de entrada). */
  numeros: string[];
};

/**
 * Animales con la exposición económica mínima exacta.
 * Compara con Prisma.Decimal (nunca strings lexicográficos).
 * No recalcula exposición: opera sobre filas ya agregadas.
 */
export function getAnimalsWithMinimumExposure(
  animales: readonly AnimalExposicion[],
): MinExposureSelection {
  if (animales.length === 0) {
    throw new Error(
      "getAnimalsWithMinimumExposure: se requiere al menos un animal.",
    );
  }

  let minimo = new Prisma.Decimal(animales[0]!.exposicion);
  for (let i = 1; i < animales.length; i++) {
    const exp = new Prisma.Decimal(animales[i]!.exposicion);
    if (exp.lt(minimo)) minimo = exp;
  }

  const numeros: string[] = [];
  for (const animal of animales) {
    if (new Prisma.Decimal(animal.exposicion).eq(minimo)) {
      numeros.push(animal.numeroAnimal);
    }
  }

  return {
    exposicionMinima: minimo.toFixed(2),
    numeros,
  };
}
