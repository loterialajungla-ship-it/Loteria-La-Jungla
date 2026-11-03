/**
 * Lógica de dominio para `repair-animal-names:production`.
 * Solo actualiza Animal.nombre cuando difiere del catálogo canónico.
 * Sin PrismaClient en import; fakes inyectables en tests.
 */
import {
  ANIMALES_CANONICOS,
  CATALOGO_ANIMALITOS_ESPERADO,
  assertCanonicalAnimalCatalog,
  validateCanonicalAnimalCatalog,
} from "@/lib/resultados/catalogo-animalitos-canonico";

export class RepairAnimalNamesProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RepairAnimalNamesProductionError";
    this.code = code;
  }
}

export type AnimalNameRow = {
  numero: string;
  nombre: string;
  imagen?: string | null;
};

export type RepairAnimalNamesProductionResult = {
  status: "repaired" | "already_canonical";
  updated: number;
  unchanged: number;
};

export type RepairAnimalNamesProductionDb = {
  animal: {
    findMany: (args: {
      select: { numero: true; nombre: true };
    }) => Promise<AnimalNameRow[]>;
    update: (args: {
      where: { numero: string };
      data: { nombre: string };
      select: { numero: true; nombre: true };
    }) => Promise<{ numero: string; nombre: string }>;
  };
  $transaction: <T>(
    fn: (tx: RepairAnimalNamesProductionDb) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Verifica que la fuente canónica del proyecto tiene la forma esperada
 * (38 entradas, números/nombres no vacíos, sin duplicados internos).
 */
export function assertCanonicalSourceIntegrity(): void {
  if (ANIMALES_CANONICOS.length !== CATALOGO_ANIMALITOS_ESPERADO) {
    throw new RepairAnimalNamesProductionError(
      "CANONICAL_SOURCE_INVALID",
      "Reparación de nombres Animal abortada: la fuente canónica no tiene el tamaño esperado.",
    );
  }
  if (CATALOGO_ANIMALITOS_ESPERADO !== 38) {
    throw new RepairAnimalNamesProductionError(
      "CANONICAL_SOURCE_INVALID",
      "Reparación de nombres Animal abortada: se esperaban exactamente 38 animales canónicos.",
    );
  }
  const check = validateCanonicalAnimalCatalog([...ANIMALES_CANONICOS]);
  if (!check.ok) {
    throw new RepairAnimalNamesProductionError(
      "CANONICAL_SOURCE_INVALID",
      `Reparación de nombres Animal abortada: fuente canónica inválida (${check.code}).`,
    );
  }
}

/**
 * Precondiciones sobre filas leídas de DB: exactamente el set canónico de números.
 * No escribe. No exige que los nombres ya sean canónicos.
 */
export function assertProductionAnimalNumberSet(
  rows: readonly { numero: string; nombre: string }[],
): void {
  const byNumero = new Map<string, string>();
  for (const row of rows) {
    const numero = typeof row.numero === "string" ? row.numero.trim() : "";
    if (!numero) {
      throw new RepairAnimalNamesProductionError(
        "CATALOG_EMPTY_NUMERO",
        "Reparación de nombres Animal abortada: hay un número vacío. No se modifica nada.",
      );
    }
    if (byNumero.has(numero)) {
      throw new RepairAnimalNamesProductionError(
        "CATALOG_DUPLICATE",
        "Reparación de nombres Animal abortada: número duplicado. No se modifica nada.",
      );
    }
    byNumero.set(numero, row.nombre);
  }

  if (byNumero.size !== CATALOGO_ANIMALITOS_ESPERADO) {
    throw new RepairAnimalNamesProductionError(
      "CATALOG_SIZE",
      `Reparación de nombres Animal abortada: se esperaban ${CATALOGO_ANIMALITOS_ESPERADO} animales; hay ${byNumero.size}. No se modifica nada.`,
    );
  }

  const canonicalNumeros = new Set(ANIMALES_CANONICOS.map((a) => a.numero));
  for (const numero of byNumero.keys()) {
    if (!canonicalNumeros.has(numero)) {
      throw new RepairAnimalNamesProductionError(
        "CATALOG_EXTRA",
        "Reparación de nombres Animal abortada: hay un número no canónico. No se modifica nada.",
      );
    }
  }

  for (const expected of ANIMALES_CANONICOS) {
    if (!byNumero.has(expected.numero)) {
      throw new RepairAnimalNamesProductionError(
        "CATALOG_MISSING",
        "Reparación de nombres Animal abortada: falta un número canónico. No se modifica nada.",
      );
    }
  }
}

export function planAnimalNameRepairs(
  rows: readonly { numero: string; nombre: string }[],
): { numero: string; nombreCanonico: string }[] {
  assertProductionAnimalNumberSet(rows);
  const byNumero = new Map(rows.map((r) => [r.numero.trim(), r.nombre]));
  const repairs: { numero: string; nombreCanonico: string }[] = [];
  for (const expected of ANIMALES_CANONICOS) {
    const actual = byNumero.get(expected.numero);
    if (actual !== expected.nombre) {
      repairs.push({
        numero: expected.numero,
        nombreCanonico: expected.nombre,
      });
    }
  }
  return repairs;
}

/**
 * Actualiza solo Animal.nombre para filas que difieren del canónico.
 * TX: updates + relectura + assert canónico (rollback si falla).
 */
export async function runRepairAnimalNamesProduction(
  db: RepairAnimalNamesProductionDb,
): Promise<RepairAnimalNamesProductionResult> {
  assertCanonicalSourceIntegrity();

  const initial = await db.animal.findMany({
    select: { numero: true, nombre: true },
  });
  const repairs = planAnimalNameRepairs(initial);

  if (repairs.length === 0) {
    // Reafirmar canonicidad completa (nombres ya correctos).
    assertCanonicalAnimalCatalog(initial);
    return {
      status: "already_canonical",
      updated: 0,
      unchanged: CATALOGO_ANIMALITOS_ESPERADO,
    };
  }

  return db.$transaction(async (tx) => {
    for (const item of repairs) {
      await tx.animal.update({
        where: { numero: item.numero },
        data: { nombre: item.nombreCanonico },
        select: { numero: true, nombre: true },
      });
    }

    const after = await tx.animal.findMany({
      select: { numero: true, nombre: true },
    });

    try {
      assertCanonicalAnimalCatalog(after);
    } catch (e) {
      throw new RepairAnimalNamesProductionError(
        "POST_REPAIR_VALIDATION_FAILED",
        e instanceof Error
          ? `Reparación de nombres Animal abortada tras escritura (rollback): ${e.message}`
          : "Reparación de nombres Animal abortada tras escritura (rollback).",
      );
    }

    return {
      status: "repaired" as const,
      updated: repairs.length,
      unchanged: CATALOGO_ANIMALITOS_ESPERADO - repairs.length,
    };
  });
}
