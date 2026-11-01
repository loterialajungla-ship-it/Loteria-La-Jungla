/**
 * Helpers de UI para ordenación de tablas (cliente).
 * No construye consultas Prisma ni valida parámetros HTTP.
 */

export type TableSortDir = "asc" | "desc";

export type TableSortState<K extends string = string> = {
  key: K | null;
  dir: TableSortDir | null;
};

export const TABLE_SORT_DEFAULT: TableSortState = {
  key: null,
  dir: null,
};

export type CycleTableSortOptions = {
  /**
   * Dirección al activar una columna nueva (o tras volver del default).
   * Por defecto: `"asc"`.
   */
  firstDir?: TableSortDir;
};

function oppositeDir(dir: TableSortDir): TableSortDir {
  return dir === "asc" ? "desc" : "asc";
}

/**
 * Ciclo de tres clics:
 * - otra columna → firstDir
 * - misma columna en firstDir → dirección opuesta
 * - misma columna en la opuesta → orden predeterminado (null/null)
 */
export function cycleTableSort<K extends string>(
  current: TableSortState<K>,
  clicked: K,
  options?: CycleTableSortOptions,
): TableSortState<K> {
  const firstDir: TableSortDir = options?.firstDir ?? "asc";
  const secondDir = oppositeDir(firstDir);

  if (current.key !== clicked) {
    return { key: clicked, dir: firstDir };
  }
  if (current.dir === firstDir) {
    return { key: clicked, dir: secondDir };
  }
  return { key: null, dir: null };
}

export function ariaSortValue<K extends string>(
  column: K,
  state: TableSortState<K>,
): "ascending" | "descending" | "none" {
  if (state.key !== column || state.dir == null) return "none";
  return state.dir === "asc" ? "ascending" : "descending";
}

/** Indicador visual discreto (usar con aria-hidden; aria-sort va en el th). */
export function sortIndicatorGlyph<K extends string>(
  column: K,
  state: TableSortState<K>,
): "↕" | "↑" | "↓" {
  if (state.key !== column || state.dir == null) return "↕";
  return state.dir === "asc" ? "↑" : "↓";
}

export function isSortColumnActive<K extends string>(
  column: K,
  state: TableSortState<K>,
): boolean {
  return state.key === column && state.dir != null;
}
