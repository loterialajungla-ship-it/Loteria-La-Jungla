import type { AnimalExposicion } from "@/lib/tickets/aggregate-exposure";
import { ordenCatalogoAnimal } from "@/lib/tickets/aggregate-exposure";

export type ExposureSortKey =
  | "animal"
  | "totalApostado"
  | "exposicion"
  | "ticketsAfectados";

export type ExposureSortDir = "asc" | "desc";

export type ExposureSortState = {
  key: ExposureSortKey | null;
  dir: ExposureSortDir | null;
};

export const EXPOSURE_SORT_DEFAULT: ExposureSortState = {
  key: null,
  dir: null,
};

/** Ciclo: otra columna → ASC; misma ASC → DESC; misma DESC → default. */
export function cycleExposureSort(
  current: ExposureSortState,
  clicked: ExposureSortKey,
): ExposureSortState {
  if (current.key !== clicked) {
    return { key: clicked, dir: "asc" };
  }
  if (current.dir === "asc") {
    return { key: clicked, dir: "desc" };
  }
  return { ...EXPOSURE_SORT_DEFAULT };
}

function compareMoney(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const fa = Number.isFinite(na) ? na : 0;
  const fb = Number.isFinite(nb) ? nb : 0;
  return fa - fb;
}

function compareCatalog(a: string, b: string): number {
  return ordenCatalogoAnimal(a) - ordenCatalogoAnimal(b);
}

/**
 * Compara dos filas para la columna activa.
 * Desempate estable: siempre orden de catálogo por numeroAnimal.
 */
export function compareExposureRows(
  a: AnimalExposicion,
  b: AnimalExposicion,
  key: ExposureSortKey,
  dir: ExposureSortDir,
): number {
  let primary = 0;
  switch (key) {
    case "animal":
      // ASC/DESC sobre orden de catálogo (no alfabético de nombre).
      primary = compareCatalog(a.numeroAnimal, b.numeroAnimal);
      break;
    case "totalApostado":
      primary = compareMoney(a.totalApostado, b.totalApostado);
      break;
    case "exposicion":
      primary = compareMoney(a.exposicion, b.exposicion);
      break;
    case "ticketsAfectados":
      primary = a.ticketsAfectados - b.ticketsAfectados;
      break;
    default: {
      const _exhaustive: never = key;
      void _exhaustive;
      primary = 0;
    }
  }

  if (primary !== 0) {
    return dir === "asc" ? primary : -primary;
  }
  return compareCatalog(a.numeroAnimal, b.numeroAnimal);
}

/**
 * Devuelve una copia ordenada. No muta `animales` ni sus elementos.
 * Sin sort activo → copia en el orden recibido (catálogo).
 */
export function sortExposureAnimals(
  animales: readonly AnimalExposicion[],
  state: ExposureSortState,
): AnimalExposicion[] {
  const copy = animales.slice();
  if (state.key == null || state.dir == null) {
    return copy;
  }
  const key = state.key;
  const dir = state.dir;
  copy.sort((a, b) => compareExposureRows(a, b, key, dir));
  return copy;
}

export function ariaSortValue(
  column: ExposureSortKey,
  state: ExposureSortState,
): "ascending" | "descending" | "none" {
  if (state.key !== column || state.dir == null) return "none";
  return state.dir === "asc" ? "ascending" : "descending";
}
