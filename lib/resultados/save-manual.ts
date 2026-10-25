import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { assertCanonicalAnimalCatalogFromDb } from "@/lib/resultados/catalogo-animalitos-canonico";
import { MOTIVO_CORRECCION_MAX } from "@/lib/resultados/correction-constants";
import { reconcilePendingScheduleForPublishedSlot } from "@/lib/resultados/reconcile-pending-schedule";

export { MOTIVO_CORRECCION_MAX } from "@/lib/resultados/correction-constants";

export type SaveManualDb = Pick<
  PrismaClient,
  "resultado" | "resultadoProgramado" | "auditoria" | "animal" | "$transaction"
>;

export type SaveManualResultRow = {
  id: string;
  hora: number;
  numero: string;
  origen: "MANUAL";
  animal: { nombre: string };
};

export class ResultadoDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ResultadoDomainError";
    this.code = code;
  }
}

/** Ya existe resultado: hace falta corrección controlada (no create silencioso). */
export class ResultadoCorrectionRequiredError extends ResultadoDomainError {
  readonly currentNumero: string | null;

  constructor(
    message = "Ya existe un resultado para esa fecha y hora. Usa la corrección controlada.",
    currentNumero: string | null = null,
  ) {
    super("CORRECTION_REQUIRED", message);
    this.name = "ResultadoCorrectionRequiredError";
    this.currentNumero = currentNumero;
  }
}

/** El número vigente no coincide con el que el admin consultó. */
export class ResultadoCorrectionConflictError extends ResultadoDomainError {
  readonly currentNumero: string;

  constructor(currentNumero: string) {
    super(
      "RESULT_CONFLICT",
      "El resultado cambió desde que lo consultaste. Recarga e inténtalo de nuevo.",
    );
    this.name = "ResultadoCorrectionConflictError";
    this.currentNumero = currentNumero;
  }
}

export class ResultadoCorrectionValidationError extends ResultadoDomainError {
  constructor(message: string, code = "CORRECTION_VALIDATION") {
    super(code, message);
    this.name = "ResultadoCorrectionValidationError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Normaliza el motivo de corrección. Vacío tras trim → error.
 * Puro: usable en tests sin DB.
 */
export function normalizeMotivoCorreccion(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ResultadoCorrectionValidationError(
      "El motivo de corrección es obligatorio.",
      "MOTIVO_REQUIRED",
    );
  }
  const motivo = raw.trim();
  if (!motivo) {
    throw new ResultadoCorrectionValidationError(
      "El motivo de corrección es obligatorio.",
      "MOTIVO_REQUIRED",
    );
  }
  if (motivo.length > MOTIVO_CORRECCION_MAX) {
    throw new ResultadoCorrectionValidationError(
      `El motivo no puede superar ${MOTIVO_CORRECCION_MAX} caracteres.`,
      "MOTIVO_TOO_LONG",
    );
  }
  return motivo;
}

function assertConfirmCorrection(confirm: unknown): void {
  if (confirm !== true) {
    throw new ResultadoCorrectionValidationError(
      "Debes confirmar explícitamente la corrección del resultado publicado.",
      "CONFIRM_REQUIRED",
    );
  }
}

function assertExpectedNumero(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ResultadoCorrectionValidationError(
      "Falta el número de resultado esperado (concurrencia).",
      "EXPECTED_NUMERO_REQUIRED",
    );
  }
  return raw.trim();
}

/**
 * Crea un resultado MANUAL si no existe.
 * Si ya hay fila (P2002 u otra carrera), NO actualiza: exige corrección controlada.
 * El cron NUNCA usa esta ruta.
 */
export async function createManualResult(
  db: SaveManualDb,
  args: {
    fecha: Date;
    hora: number;
    numero: string;
    adminUserId: string;
  },
): Promise<SaveManualResultRow> {
  const { fecha, hora, numero, adminUserId } = args;
  const fechaStr = fechaAYYYYMMDD(fecha);

  // Fail-closed: catálogo canónico antes de cualquier escritura/auditoría.
  await assertCanonicalAnimalCatalogFromDb(db);

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.resultado.create({
        data: { fecha, hora, numero, origen: "MANUAL" },
        include: { animal: true },
      });

      // Coherencia con cron: no dejar PENDIENTE tras publicación inmediata.
      const reconciled = await reconcilePendingScheduleForPublishedSlot(tx, {
        fecha,
        hora,
        resultadoId: created.id,
        numero,
      });

      await recordAuditEvent(tx, {
        usuarioId: adminUserId,
        accion: "CREAR_RESULTADO",
        entidad: "RESULTADO",
        entidadId: created.id,
        detalle: {
          fecha: fechaStr,
          hora,
          numeroAnterior: null,
          numeroNuevo: numero,
          origen: "MANUAL",
          ...(reconciled.linked ? { desdeProgramacion: true } : {}),
        },
      });

      return {
        id: created.id,
        hora: created.hora,
        numero: created.numero,
        origen: "MANUAL" as const,
        animal: { nombre: created.animal.nombre },
      };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await db.resultado.findUnique({
      where: { fecha_hora: { fecha, hora } },
      select: { numero: true },
    });
    throw new ResultadoCorrectionRequiredError(
      "Ya existe un resultado para esa fecha y hora. Usa la corrección controlada.",
      existing?.numero ?? null,
    );
  }
}

/**
 * @deprecated Preferir `createManualResult`. Alias create-only (sin update silencioso).
 */
export async function saveManualResult(
  db: SaveManualDb,
  args: {
    fecha: Date;
    hora: number;
    numero: string;
    adminUserId: string;
  },
): Promise<SaveManualResultRow> {
  return createManualResult(db, args);
}

export type CorrectPublishedResultArgs = {
  fecha: Date;
  hora: number;
  numero: string;
  adminUserId: string;
  /** Debe ser `true`. */
  confirmCorrection: unknown;
  /** Motivo obligatorio (se normaliza con trim). */
  motivo: unknown;
  /** Número vigente que el admin vio al consultar (optimistic concurrency). */
  expectedNumero: unknown;
};

/**
 * Corrige un resultado ya publicado.
 * Exige confirmación, motivo y CAS atómico (`updateMany` por id + numero esperado).
 * Solo si `count === 1` se audita. Update + auditoría en la misma TX.
 */
export async function correctPublishedResult(
  db: SaveManualDb,
  args: CorrectPublishedResultArgs,
): Promise<SaveManualResultRow> {
  assertConfirmCorrection(args.confirmCorrection);
  const motivo = normalizeMotivoCorreccion(args.motivo);
  const expectedNumero = assertExpectedNumero(args.expectedNumero);
  const numero = args.numero.trim();
  if (!numero) {
    throw new ResultadoCorrectionValidationError(
      "El número de animalito es obligatorio.",
      "NUMERO_REQUIRED",
    );
  }

  const { fecha, hora, adminUserId } = args;
  const fechaStr = fechaAYYYYMMDD(fecha);

  // Fail-closed: catálogo canónico antes de cualquier escritura/auditoría.
  await assertCanonicalAnimalCatalogFromDb(db);

  return db.$transaction(async (tx) => {
    const previo = await tx.resultado.findUnique({
      where: { fecha_hora: { fecha, hora } },
      select: { id: true, numero: true, origen: true },
    });

    if (!previo) {
      throw new ResultadoCorrectionValidationError(
        "No hay resultado publicado para corregir. Publica uno nuevo primero.",
        "NOT_FOUND_FOR_CORRECTION",
      );
    }

    // Fast-path informativo (no sustituye el CAS de updateMany).
    if (previo.numero !== expectedNumero) {
      throw new ResultadoCorrectionConflictError(previo.numero);
    }

    // Nada que cambiar (mismo número y ya MANUAL): no auditar de nuevo.
    if (previo.numero === numero && previo.origen === "MANUAL") {
      const animal = await tx.resultado.findUniqueOrThrow({
        where: { id: previo.id },
        include: { animal: true },
      });
      return {
        id: animal.id,
        hora: animal.hora,
        numero: animal.numero,
        origen: "MANUAL" as const,
        animal: { nombre: animal.animal.nombre },
      };
    }

    // CAS a nivel BD: solo actualiza si id y numero siguen siendo los esperados.
    const cas = await tx.resultado.updateMany({
      where: { id: previo.id, numero: expectedNumero },
      data: { numero, origen: "MANUAL" },
    });

    if (cas.count !== 1) {
      const current = await tx.resultado.findUnique({
        where: { id: previo.id },
        select: { numero: true },
      });
      throw new ResultadoCorrectionConflictError(
        current?.numero ?? expectedNumero,
      );
    }

    const updated = await tx.resultado.findUniqueOrThrow({
      where: { id: previo.id },
      include: { animal: true },
    });

    // numeroAnterior = valor CAS (el que realmente se sustituyó).
    await recordAuditEvent(tx, {
      usuarioId: adminUserId,
      accion: "MODIFICAR_RESULTADO",
      entidad: "RESULTADO",
      entidadId: updated.id,
      detalle: {
        fecha: fechaStr,
        hora,
        numeroAnterior: expectedNumero,
        numeroNuevo: numero,
        origen: "MANUAL",
        origenAnterior: previo.origen,
        motivo,
        correccionControlada: true,
      },
    });

    return {
      id: updated.id,
      hora: updated.hora,
      numero: updated.numero,
      origen: "MANUAL" as const,
      animal: { nombre: updated.animal.nombre },
    };
  });
}
