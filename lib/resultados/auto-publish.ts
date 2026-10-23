import { Prisma } from "@prisma/client";
import type { OrigenResultado, PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  assertCanonicalAnimalCatalog,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import { pickRandomAnimalNumero } from "@/lib/resultados/pick-animal";
import {
  listDueDrawSlots,
  type DrawSlot,
} from "@/lib/resultados/pending-slots";

export type AutoPublishSlotResult =
  | {
      status: "created";
      fecha: string;
      hora: number;
      numero: string;
      resultadoId: string;
      origen: OrigenResultado;
    }
  | {
      status: "skipped_exists";
      fecha: string;
      hora: number;
      numero: string;
      origen: OrigenResultado;
    }
  | {
      status: "error";
      fecha: string;
      hora: number;
      /** Mensaje genérico; nunca secretos ni detalle interno de Prisma. */
      error: string;
    };

export type AutoPublishRunResult = {
  /** false si algún sorteo falló; el resto pudo procesarse igual. */
  ok: boolean;
  processed: number;
  created: number;
  skippedExists: number;
  failed: number;
  results: AutoPublishSlotResult[];
  catalogSize: number;
  at: string;
};

type AutoPublishDb = Pick<
  PrismaClient,
  "animal" | "resultado" | "auditoria" | "$transaction"
>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

const SLOT_ERROR_PUBLIC = "No se pudo publicar el sorteo.";

export type TryCreateAutomaticOptions = {
  /**
   * Filas de catálogo ya leídas y validadas por el caller
   * (p. ej. `runAutomaticResultsPublish`). Si se omiten, esta función
   * lee y valida el catálogo canónico antes de crear.
   */
  catalogRows?: readonly { numero: string; nombre: string }[];
};

/**
 * Intenta crear un resultado AUTOMATICO para (fecha, hora).
 * Create-only: si ya existe (manual o automático), no sobrescribe.
 * Idempotente bajo reintentos y carreras (@@unique + P2002).
 * Fail-closed: valida catálogo canónico antes de crear/auditar.
 */
export async function tryCreateAutomaticResult(
  db: AutoPublishDb,
  slot: DrawSlot,
  ahora = new Date(),
  options?: TryCreateAutomaticOptions,
): Promise<Exclude<AutoPublishSlotResult, { status: "error" }>> {
  const fechaStr = fechaAYYYYMMDD(slot.fecha);

  const existing = await db.resultado.findUnique({
    where: { fecha_hora: { fecha: slot.fecha, hora: slot.hora } },
    select: { id: true, numero: true, origen: true },
  });
  if (existing) {
    return {
      status: "skipped_exists",
      fecha: fechaStr,
      hora: slot.hora,
      numero: existing.numero,
      origen: existing.origen,
    };
  }

  let catalogRows: readonly { numero: string; nombre: string }[];
  if (options?.catalogRows) {
    assertCanonicalAnimalCatalog(options.catalogRows);
    catalogRows = options.catalogRows;
  } else {
    catalogRows = await db.animal.findMany({
      select: { numero: true, nombre: true },
    });
    assertCanonicalAnimalCatalog(catalogRows);
  }
  const numeros = catalogRows.map((a) => a.numero);
  const numero = pickRandomAnimalNumero(numeros);

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.resultado.create({
        data: {
          fecha: slot.fecha,
          hora: slot.hora,
          numero,
          origen: "AUTOMATICO",
        },
        select: { id: true, numero: true, origen: true },
      });

      await recordAuditEvent(tx, {
        usuarioId: null,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: row.id,
        detalle: {
          fecha: fechaStr,
          hora: slot.hora,
          numeroAnterior: null,
          numeroNuevo: row.numero,
          origen: "AUTOMATICO",
          generadoEn: ahora.toISOString(),
        },
      });

      return row;
    });

    return {
      status: "created",
      fecha: fechaStr,
      hora: slot.hora,
      numero: created.numero,
      resultadoId: created.id,
      origen: created.origen,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const race = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: slot.fecha, hora: slot.hora } },
      select: { numero: true, origen: true },
    });
    if (!race) throw error;

    return {
      status: "skipped_exists",
      fecha: fechaStr,
      hora: slot.hora,
      numero: race.numero,
      origen: race.origen,
    };
  }
}

/**
 * Publica resultados AUTOMATICOS para todas las franjas vencidas del día
 * America/Caracas que aún no tengan resultado.
 * Un fallo en una franja no detiene las demás.
 *
 * Fail-closed: valida el catálogo canónico (38 números + nombres) **antes**
 * de cualquier create de resultado.
 */
export async function runAutomaticResultsPublish(
  db: AutoPublishDb,
  ahora = new Date(),
): Promise<AutoPublishRunResult> {
  const animalesCatalogo = await db.animal.findMany({
    select: { numero: true, nombre: true },
  });
  // Abortar aquí: ninguna escritura de Resultado/auditoría aún.
  assertCanonicalAnimalCatalog(animalesCatalogo);
  const catalogSize = animalesCatalogo.length;

  const slots = listDueDrawSlots(ahora);
  const results: AutoPublishSlotResult[] = [];
  let created = 0;
  let skippedExists = 0;
  let failed = 0;

  for (const slot of slots) {
    const fechaStr = fechaAYYYYMMDD(slot.fecha);
    try {
      const r = await tryCreateAutomaticResult(db, slot, ahora, {
        catalogRows: animalesCatalogo,
      });
      results.push(r);
      if (r.status === "created") created += 1;
      if (r.status === "skipped_exists") skippedExists += 1;
    } catch (error) {
      failed += 1;
      results.push({
        status: "error",
        fecha: fechaStr,
        hora: slot.hora,
        error: SLOT_ERROR_PUBLIC,
      });
      console.error("[resultados-auto] slot failed", {
        fecha: fechaStr,
        hora: slot.hora,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return {
    ok: failed === 0,
    processed: results.length,
    created,
    skippedExists,
    failed,
    results,
    catalogSize,
    at: ahora.toISOString(),
  };
}
