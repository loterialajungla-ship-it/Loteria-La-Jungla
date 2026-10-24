/**
 * Fuente única del catálogo oficial de animalitos (38).
 * Usada por prisma/seed, validación de auto-publish y tests.
 */

export type AnimalCanonico = {
  numero: string;
  nombre: string;
};

/** Catálogo canónico: "0", "00", "01"…"36". */
export const ANIMALES_CANONICOS: readonly AnimalCanonico[] = [
  { numero: "0", nombre: "Delfín" },
  { numero: "00", nombre: "Ballena" },
  { numero: "01", nombre: "Carnero" },
  { numero: "02", nombre: "Toro" },
  { numero: "03", nombre: "Ciempiés" },
  { numero: "04", nombre: "Alacrán" },
  { numero: "05", nombre: "León" },
  { numero: "06", nombre: "Rana" },
  { numero: "07", nombre: "Perico" },
  { numero: "08", nombre: "Ratón" },
  { numero: "09", nombre: "Águila" },
  { numero: "10", nombre: "Tigre" },
  { numero: "11", nombre: "Gato" },
  { numero: "12", nombre: "Caballo" },
  { numero: "13", nombre: "Mono" },
  { numero: "14", nombre: "Paloma" },
  { numero: "15", nombre: "Zorro" },
  { numero: "16", nombre: "Oso" },
  { numero: "17", nombre: "Pavo" },
  { numero: "18", nombre: "Burro" },
  { numero: "19", nombre: "Chivo" },
  { numero: "20", nombre: "Cerdo" },
  { numero: "21", nombre: "Gallo" },
  { numero: "22", nombre: "Camello" },
  { numero: "23", nombre: "Cebra" },
  { numero: "24", nombre: "Iguana" },
  { numero: "25", nombre: "Gallina" },
  { numero: "26", nombre: "Vaca" },
  { numero: "27", nombre: "Perro" },
  { numero: "28", nombre: "Zamuro" },
  { numero: "29", nombre: "Elefante" },
  { numero: "30", nombre: "Caimán" },
  { numero: "31", nombre: "Lapa" },
  { numero: "32", nombre: "Ardilla" },
  { numero: "33", nombre: "Pescado" },
  { numero: "34", nombre: "Venado" },
  { numero: "35", nombre: "Jirafa" },
  { numero: "36", nombre: "Culebra" },
] as const;

export const CATALOGO_ANIMALITOS_ESPERADO = ANIMALES_CANONICOS.length;

export type CatalogoAnimalitosCheck =
  | { ok: true }
  | { ok: false; code: string; reason: string };

export class CatalogoAnimalitosInvalidoError extends Error {
  readonly code: string;

  constructor(message: string, code = "CATALOG_INVALID") {
    super(message);
    this.name = "CatalogoAnimalitosInvalidoError";
    this.code = code;
  }
}

/**
 * Valida que las filas coincidan exactamente con el catálogo canónico
 * (mismos 38 números y nombres; sin duplicados ni extras).
 * Puro: usable en tests sin DB.
 */
export function validateCanonicalAnimalCatalog(
  rows: readonly { numero: string; nombre: string }[],
): CatalogoAnimalitosCheck {
  const byNumero = new Map<string, string>();

  for (const row of rows) {
    const numero = typeof row.numero === "string" ? row.numero.trim() : "";
    const nombre = typeof row.nombre === "string" ? row.nombre.trim() : "";
    if (!numero) {
      return {
        ok: false,
        code: "CATALOG_INVALID",
        reason: "Catálogo de animalitos inválido: número vacío.",
      };
    }
    if (byNumero.has(numero)) {
      return {
        ok: false,
        code: "CATALOG_DUPLICATE",
        reason: "Catálogo de animalitos inválido: número duplicado.",
      };
    }
    byNumero.set(numero, nombre);
  }

  if (byNumero.size !== CATALOGO_ANIMALITOS_ESPERADO) {
    return {
      ok: false,
      code: "CATALOG_SIZE",
      reason: `Catálogo de animalitos inválido: se esperaban ${CATALOGO_ANIMALITOS_ESPERADO} entradas.`,
    };
  }

  const canonicalNumeros = new Set(ANIMALES_CANONICOS.map((a) => a.numero));
  for (const numero of byNumero.keys()) {
    if (!canonicalNumeros.has(numero)) {
      return {
        ok: false,
        code: "CATALOG_EXTRA",
        reason: "Catálogo de animalitos inválido: número no canónico.",
      };
    }
  }

  for (const expected of ANIMALES_CANONICOS) {
    const actualNombre = byNumero.get(expected.numero);
    if (actualNombre === undefined) {
      return {
        ok: false,
        code: "CATALOG_MISSING",
        reason: "Catálogo de animalitos inválido: falta un número canónico.",
      };
    }
    if (actualNombre !== expected.nombre) {
      return {
        ok: false,
        code: "CATALOG_NAME_MISMATCH",
        reason:
          "Catálogo de animalitos inválido: nombre no coincide con el canónico.",
      };
    }
  }

  return { ok: true };
}

/** Lanza si el catálogo no es exactamente el canónico. */
export function assertCanonicalAnimalCatalog(
  rows: readonly { numero: string; nombre: string }[],
): void {
  const check = validateCanonicalAnimalCatalog(rows);
  if (!check.ok) {
    throw new CatalogoAnimalitosInvalidoError(check.reason, check.code);
  }
}

type AnimalCatalogReader = {
  animal: {
    findMany: (args: {
      select: { numero: true; nombre: true };
    }) => Promise<{ numero: string; nombre: string }[]>;
  };
};

/**
 * Lectura de solo lectura + assert canónico.
 * Usada por el dominio de resultados antes de cualquier escritura.
 */
export async function assertCanonicalAnimalCatalogFromDb(
  db: AnimalCatalogReader,
): Promise<{ numero: string; nombre: string }[]> {
  const rows = await db.animal.findMany({
    select: { numero: true, nombre: true },
  });
  assertCanonicalAnimalCatalog(rows);
  return rows;
}
