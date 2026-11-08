import type { OrigenResultado, PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  assertCanonicalAnimalCatalog,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import { getAnimalsWithMinimumExposure } from "@/lib/resultados/min-exposure-selection";
import {
  classifyP2002Target,
  isUniqueViolation,
} from "@/lib/resultados/p2002";
import { pickRandomAnimalNumero } from "@/lib/resultados/pick-animal";
import {
  listDueDrawSlots,
  type DrawSlot,
} from "@/lib/resultados/pending-slots";
import { reconcilePendingScheduleForPublishedSlot } from "@/lib/resultados/reconcile-pending-schedule";
import { getExposureForDraw } from "@/lib/tickets/get-exposure";

export { classifyP2002Target } from "@/lib/resultados/p2002";

export type AutoPublishSlotResult =
  | {
      status: "created";
      fecha: string;
      hora: number;
      numero: string;
      resultadoId: string;
      origen: OrigenResultado;
      /** Presente en la corrida del cron; medición monotónica (ms). */
      durationMs?: number;
    }
  | {
      status: "skipped_exists";
      fecha: string;
      hora: number;
      numero: string;
      origen: OrigenResultado;
      /** Presente en la corrida del cron; medición monotónica (ms). */
      durationMs?: number;
    }
  | {
      status: "error";
      fecha: string;
      hora: number;
      /** Mensaje genérico; nunca secretos ni detalle interno de Prisma. */
      error: string;
      /** Presente en la corrida del cron; medición monotónica (ms). */
      durationMs?: number;
    };

export type AutoPublishRunResult = {
  /** false si algún sorteo falló; el resto pudo procesarse igual. */
  ok: boolean;
  processed: number;
  /** Franjas intentadas en esta corrida (igual a `processed`). */
  slotsAttempted: number;
  created: number;
  skippedExists: number;
  failed: number;
  results: AutoPublishSlotResult[];
  catalogSize: number;
  at: string;
  /** Duración monotónica total de la corrida (ms), tras validar catálogo. */
  durationTotalMs: number;
};

type AutoPublishDb = Pick<
  PrismaClient,
  "animal" | "resultado" | "resultadoProgramado" | "auditoria" | "$transaction"
>;

/** Enlace programación→resultado falló (cancelación/cambio concurrente). */
export class ProgramacionMaterializacionError extends Error {
  readonly code = "SCHEDULE_LINK_FAILED";

  constructor(message = "No se pudo materializar la programación pendiente.") {
    super(message);
    this.name = "ProgramacionMaterializacionError";
  }
}

const SLOT_ERROR_PUBLIC = "No se pudo publicar el sorteo.";

/** Log JSON acotado del cron; nunca secretos ni detalle SQL. */
function logCronObservability(payload: Record<string, unknown>): void {
  console.info(JSON.stringify({ channel: "cron.resultados", ...payload }));
}

export type TryCreateAutomaticOptions = {
  /**
   * Filas de catálogo ya leídas y validadas por el caller
   * (p. ej. `runAutomaticResultsPublish`). Si se omiten, esta función
   * lee y valida el catálogo canónico antes de crear.
   */
  catalogRows?: readonly { numero: string; nombre: string }[];
};

/**
 * Intenta crear un resultado para (fecha, hora) vencida sin Resultado.
 * Preferencia: programación PENDIENTE → Resultado MANUAL con ese número.
 * Si no hay pendiente: AUTOMATICO entre animales con exposición mínima
 * del sorteo (fecha+hora), vía getExposureForDraw + pickRandomAnimalNumero.
 * Create-only: si ya existe, no sobrescribe. Idempotente (@@unique + P2002).
 * Fail-closed: valida catálogo canónico antes de crear/auditar.
 *
 * Atomicidad programada: create + updateMany(id, PENDIENTE, numero) con
 * count===1; si no, throw → rollback de Resultado y auditoría de la TX.
 * Exposición AUTOMATICO: lectura dentro de la misma TX que el create.
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
  const catalogSet = new Set(catalogRows.map((a) => a.numero));

  try {
    const created = await db.$transaction(async (tx) => {
      // Releer programación dentro de la TX (solo PENDIENTE cuenta).
      const programado = await tx.resultadoProgramado.findUnique({
        where: { fecha_hora: { fecha: slot.fecha, hora: slot.hora } },
        select: { id: true, numero: true, estado: true },
      });

      const usarProgramado =
        programado?.estado === "PENDIENTE" &&
        catalogSet.has(programado.numero);

      let numeroMaterializado: string;
      let origen: OrigenResultado;
      let seleccionAuto:
        | {
            modoSeleccion: "MIN_EXPOSICION";
            exposicionMinima: string;
            candidatos: string[];
          }
        | undefined;

      if (usarProgramado) {
        numeroMaterializado = programado!.numero;
        origen = "MANUAL";
      } else {
        // Fuente única de verdad: misma fecha/hora del slot, solo EMITIDO.
        const exposicion = await getExposureForDraw({
          fechaJuego: fechaStr,
          hora: slot.hora,
          db: tx,
        });
        const minSel = getAnimalsWithMinimumExposure(exposicion.animales);
        numeroMaterializado = pickRandomAnimalNumero(minSel.numeros);
        origen = "AUTOMATICO";
        seleccionAuto = {
          modoSeleccion: "MIN_EXPOSICION",
          exposicionMinima: minSel.exposicionMinima,
          candidatos: minSel.numeros,
        };
      }

      const row = await tx.resultado.create({
        data: {
          fecha: slot.fecha,
          hora: slot.hora,
          numero: numeroMaterializado,
          origen,
        },
        select: { id: true, numero: true, origen: true },
      });

      let desdeProgramacion = false;
      let programacionId: string | undefined;

      if (usarProgramado && programado) {
        // Condición optimista: id + PENDIENTE + número leído en esta TX.
        const linked = await tx.resultadoProgramado.updateMany({
          where: {
            id: programado.id,
            estado: "PENDIENTE",
            numero: numeroMaterializado,
          },
          data: {
            estado: "PUBLICADO",
            resultadoId: row.id,
          },
        });

        if (linked.count !== 1) {
          // Abortar TX: revierte Resultado (y cualquier auditoría posterior).
          throw new ProgramacionMaterializacionError();
        }
        desdeProgramacion = true;
        programacionId = programado.id;
      }

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
          origen: row.origen,
          generadoEn: ahora.toISOString(),
          ...(desdeProgramacion && programacionId
            ? { desdeProgramacion: true, programacionId }
            : {}),
          ...(seleccionAuto ?? {}),
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

    // Evidencia de materialización ajena: Resultado ya existe para la franja.
    const race = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: slot.fecha, hora: slot.hora } },
      select: { id: true, numero: true, origen: true },
    });

    const targetKind = classifyP2002Target(error);

    /**
     * Política P2002:
     * - `slot` + Resultado → carrera de franja: skipped_exists + reconciliar
     *   PENDIENTE por [fecha,hora] (enlace o SUPERSEDED).
     * - `unknown` + Resultado → skipped_exists; reconciliar igual usando solo
     *   la clave de franja (no el target del P2002) para no dejar huérfanas.
     * - `other`, o sin Resultado → no mutar; propagar.
     */
    if (
      race != null &&
      (targetKind === "slot" || targetKind === "unknown")
    ) {
      await reconcilePendingScheduleForPublishedSlot(db, {
        fecha: slot.fecha,
        hora: slot.hora,
        resultadoId: race.id,
        numero: race.numero,
      });

      return {
        status: "skipped_exists",
        fecha: fechaStr,
        hora: slot.hora,
        numero: race.numero,
        origen: race.origen,
      };
    }

    throw error;
  }
}

/**
 * Publica resultados para todas las franjas vencidas del día
 * America/Caracas que aún no tengan resultado.
 * Preferencia: programación PENDIENTE → MANUAL; si no, AUTOMATICO entre
 * animales con exposición mínima del sorteo.
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

  const runStarted = performance.now();
  logCronObservability({
    event: "start",
    at: ahora.toISOString(),
    slotsDue: slots.length,
    catalogSize,
  });

  for (const slot of slots) {
    const fechaStr = fechaAYYYYMMDD(slot.fecha);
    const slotStarted = performance.now();
    try {
      const r = await tryCreateAutomaticResult(db, slot, ahora, {
        catalogRows: animalesCatalogo,
      });
      const durationMs = Math.round(performance.now() - slotStarted);
      const withDuration = { ...r, durationMs };
      results.push(withDuration);
      if (r.status === "created") created += 1;
      if (r.status === "skipped_exists") skippedExists += 1;
      logCronObservability({
        event: "slot",
        fecha: fechaStr,
        hora: slot.hora,
        status: r.status,
        durationMs,
      });
    } catch {
      const durationMs = Math.round(performance.now() - slotStarted);
      failed += 1;
      results.push({
        status: "error",
        fecha: fechaStr,
        hora: slot.hora,
        error: SLOT_ERROR_PUBLIC,
        durationMs,
      });
      logCronObservability({
        event: "slot",
        fecha: fechaStr,
        hora: slot.hora,
        status: "error",
        durationMs,
      });
    }
  }

  const durationTotalMs = Math.round(performance.now() - runStarted);
  const slotsAttempted = results.length;
  const ok = failed === 0;

  logCronObservability({
    event: "end",
    at: ahora.toISOString(),
    ok,
    created,
    skippedExists,
    failed,
    slotsAttempted,
    durationTotalMs,
  });

  return {
    ok,
    processed: slotsAttempted,
    slotsAttempted,
    created,
    skippedExists,
    failed,
    results,
    catalogSize,
    at: ahora.toISOString(),
    durationTotalMs,
  };
}
