/**
 * Lógica de dominio para `repair-animal-names:test`.
 * Aplica solo reparaciones explícitas (número + nombre anterior → nuevo).
 * Sin PrismaClient en import; fakes inyectables en tests.
 */
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import { assertCanonicalSourceIntegrity } from "@/lib/dev/repair-animal-names-production";

export class RepairAnimalNamesTestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RepairAnimalNamesTestError";
    this.code = code;
  }
}

export type ExplicitAnimalNameRepair = {
  numero: string;
  nombreAnterior: string;
  nombreNuevo: string;
};

/**
 * Única reparación permitida por el procedimiento TEST actual.
 * Cochino → Cerdo en el animal número 20.
 */
export const TEST_ANIMAL_NAME_REPAIRS_ALLOWED: readonly ExplicitAnimalNameRepair[] =
  [{ numero: "20", nombreAnterior: "Cochino", nombreNuevo: "Cerdo" }];

export type RepairAnimalNamesTestResult = {
  status: "repaired" | "already_applied";
  updated: number;
  skippedAlreadyCanonical: number;
};

export type AnimalNameTestRow = {
  numero: string;
  nombre: string;
  imagen?: string | null;
};

export type RepairAnimalNamesTestDb = {
  animal: {
    findUnique: (args: {
      where: { numero: string };
      select: { numero: true; nombre: true; imagen: true };
    }) => Promise<AnimalNameTestRow | null>;
    update: (args: {
      where: { numero: string };
      data: { nombre: string };
      select: { numero: true; nombre: true; imagen: true };
    }) => Promise<AnimalNameTestRow>;
  };
  $transaction: <T>(
    fn: (tx: RepairAnimalNamesTestDb) => Promise<T>,
  ) => Promise<T>;
};

type PlannedUpdate = ExplicitAnimalNameRepair;

function canonicalNombreFor(numero: string): string | undefined {
  return ANIMALES_CANONICOS.find((a) => a.numero === numero)?.nombre;
}

/**
 * Valida que cada reparación esté en la allowlist y que el nombre nuevo
 * coincida con el catálogo canónico.
 */
export function assertExplicitRepairsAllowed(
  repairs: readonly ExplicitAnimalNameRepair[],
  allowed: readonly ExplicitAnimalNameRepair[] = TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
): void {
  if (repairs.length === 0) {
    throw new RepairAnimalNamesTestError(
      "EMPTY_REPAIR_LIST",
      "Reparación de nombres Animal de TEST abortada: la lista de reparaciones está vacía.",
    );
  }

  for (const repair of repairs) {
    const numero = repair.numero.trim();
    const anterior = repair.nombreAnterior.trim();
    const nuevo = repair.nombreNuevo.trim();

    if (!numero || !anterior || !nuevo) {
      throw new RepairAnimalNamesTestError(
        "INVALID_REPAIR_ENTRY",
        "Reparación de nombres Animal de TEST abortada: entrada de reparación inválida.",
      );
    }

    if (anterior === nuevo) {
      throw new RepairAnimalNamesTestError(
        "INVALID_REPAIR_ENTRY",
        "Reparación de nombres Animal de TEST abortada: nombre anterior y nuevo no pueden coincidir.",
      );
    }

    const inAllowlist = allowed.some(
      (a) =>
        a.numero === numero &&
        a.nombreAnterior === anterior &&
        a.nombreNuevo === nuevo,
    );
    if (!inAllowlist) {
      throw new RepairAnimalNamesTestError(
        "REPAIR_NOT_ALLOWED",
        "Reparación de nombres Animal de TEST abortada: la reparación solicitada no está en la allowlist.",
      );
    }

    const canonical = canonicalNombreFor(numero);
    if (canonical === undefined) {
      throw new RepairAnimalNamesTestError(
        "REPAIR_NOT_CANONICAL",
        "Reparación de nombres Animal de TEST abortada: número no canónico.",
      );
    }
    if (nuevo !== canonical) {
      throw new RepairAnimalNamesTestError(
        "REPAIR_NOT_CANONICAL",
        "Reparación de nombres Animal de TEST abortada: el nombre nuevo no coincide con el catálogo canónico.",
      );
    }
  }
}

/**
 * Lee el estado actual y decide updates vs idempotencia vs aborto.
 * No escribe.
 */
export async function planExplicitAnimalNameRepairs(
  db: Pick<RepairAnimalNamesTestDb, "animal">,
  repairs: readonly ExplicitAnimalNameRepair[],
): Promise<{
  toUpdate: PlannedUpdate[];
  alreadyApplied: number;
}> {
  assertExplicitRepairsAllowed(repairs);

  const toUpdate: PlannedUpdate[] = [];
  let alreadyApplied = 0;

  for (const repair of repairs) {
    const row = await db.animal.findUnique({
      where: { numero: repair.numero },
      select: { numero: true, nombre: true, imagen: true },
    });

    if (!row) {
      throw new RepairAnimalNamesTestError(
        "ANIMAL_MISSING",
        `Reparación de nombres Animal de TEST abortada: falta el animal número ${repair.numero}. No se modifica nada.`,
      );
    }

    if (row.nombre === repair.nombreNuevo) {
      alreadyApplied += 1;
      continue;
    }

    if (row.nombre !== repair.nombreAnterior) {
      throw new RepairAnimalNamesTestError(
        "UNEXPECTED_NAME",
        `Reparación de nombres Animal de TEST abortada: el animal ${repair.numero} tiene un nombre inesperado (no es «${repair.nombreAnterior}» ni «${repair.nombreNuevo}»). No se modifica nada.`,
      );
    }

    toUpdate.push(repair);
  }

  return { toUpdate, alreadyApplied };
}

/**
 * Actualiza solo Animal.nombre para filas que coinciden con la lista explícita
 * (número + nombre anterior). Idempotente si ya está el nombre nuevo.
 */
export async function runRepairAnimalNamesTest(
  db: RepairAnimalNamesTestDb,
  repairs: readonly ExplicitAnimalNameRepair[] = TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
): Promise<RepairAnimalNamesTestResult> {
  assertCanonicalSourceIntegrity();
  assertExplicitRepairsAllowed(repairs);

  const plan = await planExplicitAnimalNameRepairs(db, repairs);

  if (plan.toUpdate.length === 0) {
    return {
      status: "already_applied",
      updated: 0,
      skippedAlreadyCanonical: plan.alreadyApplied,
    };
  }

  return db.$transaction(async (tx) => {
    // Releer dentro de la TX para no aplicar si cambió concurrentemente.
    const replan = await planExplicitAnimalNameRepairs(tx, repairs);
    if (replan.toUpdate.length === 0) {
      return {
        status: "already_applied" as const,
        updated: 0,
        skippedAlreadyCanonical: replan.alreadyApplied,
      };
    }

    for (const item of replan.toUpdate) {
      const updated = await tx.animal.update({
        where: { numero: item.numero },
        data: { nombre: item.nombreNuevo },
        select: { numero: true, nombre: true, imagen: true },
      });

      if (updated.nombre !== item.nombreNuevo) {
        throw new RepairAnimalNamesTestError(
          "POST_REPAIR_VALIDATION_FAILED",
          "Reparación de nombres Animal de TEST abortada tras escritura (rollback): el nombre no quedó canónico.",
        );
      }
    }

    return {
      status: "repaired" as const,
      updated: replan.toUpdate.length,
      skippedAlreadyCanonical: replan.alreadyApplied,
    };
  });
}
