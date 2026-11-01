/**
 * Validación tipada de parámetros de ordenación (servidor / query string).
 * No construye SQL, no interpola, no conoce modelos de dominio.
 * Cada fase (tickets, usuarios, …) pasará su propia lista blanca de columnas.
 */

import type { TableSortDir, TableSortState } from "@/lib/ui/table-sort";

function asTrimmedString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** Acepta solo `"asc"` | `"desc"` (case-insensitive). Cualquier otro valor → null. */
export function parseTableSortDir(raw: unknown): TableSortDir | null {
  const v = asTrimmedString(raw);
  if (v == null) return null;
  const lower = v.toLowerCase();
  if (lower === "asc") return "asc";
  if (lower === "desc") return "desc";
  return null;
}

/**
 * Resuelve una columna solo si está en la lista blanca exacta.
 * No acepta campos arbitrarios.
 */
export function parseAllowedSortKey<K extends string>(
  raw: unknown,
  allowed: readonly K[],
): K | null {
  const v = asTrimmedString(raw);
  if (v == null) return null;
  for (const key of allowed) {
    if (key === v) return key;
  }
  return null;
}

/**
 * Ambos parámetros deben ser válidos; si falta o falla cualquiera → estado default
 * (sin ordenación activa / usar orderBy predeterminado del dominio).
 */
export function parseTableSortState<K extends string>(
  keyRaw: unknown,
  dirRaw: unknown,
  allowed: readonly K[],
): TableSortState<K> {
  const key = parseAllowedSortKey(keyRaw, allowed);
  const dir = parseTableSortDir(dirRaw);
  if (key == null || dir == null) {
    return { key: null, dir: null };
  }
  return { key, dir };
}

/**
 * Contrato mínimo para que fases posteriores construyan `orderBy` tipado
 * a partir de un mapa explícito clave → fragmento Prisma (sin SQL dinámico).
 */
export function resolveOrderByFromMap<K extends string, TOrder>(
  state: TableSortState<K>,
  orderByByKey: Readonly<Record<K, (dir: TableSortDir) => TOrder>>,
  fallback: TOrder,
): TOrder {
  if (state.key == null || state.dir == null) return fallback;
  const builder = orderByByKey[state.key];
  if (builder == null) return fallback;
  return builder(state.dir);
}
