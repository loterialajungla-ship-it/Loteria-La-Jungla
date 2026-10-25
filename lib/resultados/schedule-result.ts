/**
 * Dominio de programación de resultados.
 * Guarda/modifica/cancela selecciones PENDIENTE sin crear Resultado publicado.
 * Sin PrismaClient en import; fakes inyectables en tests.
 */
import type { EstadoResultadoProgramado, PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { fechaAYYYYMMDD, HORAS_SORTEO } from "@/lib/fecha";
import {
  classifyP2002Target,
  isUniqueViolation,
} from "@/lib/resultados/p2002";

export class ScheduleResultDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScheduleResultDomainError";
    this.code = code;
  }
}

export type ScheduleResultRow = {
  id: string;
  fecha: Date;
  hora: number;
  numero: string;
  estado: EstadoResultadoProgramado;
  resultadoId: string | null;
  createdById: string;
};

export type UpsertPendingScheduleArgs = {
  fecha: Date;
  hora: number;
  numero: string;
  adminUserId: string;
};

export type CancelPendingScheduleArgs = {
  fecha: Date;
  hora: number;
  adminUserId: string;
};

/** Compatible con PrismaClient real y fakes de test. */
export type ScheduleResultDb = Pick<
  PrismaClient,
  "animal" | "resultado" | "resultadoProgramado" | "auditoria" | "$transaction"
>;

const ESTADOS_NO_MODIFICABLES: ReadonlySet<EstadoResultadoProgramado> = new Set([
  "PUBLICADO",
  "CANCELADO",
  "SUPERSEDED",
]);

export function assertHoraSorteoValida(hora: number): void {
  if (!(HORAS_SORTEO as readonly number[]).includes(hora)) {
    throw new ScheduleResultDomainError(
      "INVALID_HORA",
      "La hora del sorteo no es válida (se esperan franjas 9–19).",
    );
  }
}

export function assertNumeroAnimalNoVacio(numero: string): string {
  const n = numero.trim();
  if (!n) {
    throw new ScheduleResultDomainError(
      "INVALID_NUMERO",
      "El número de animal es obligatorio.",
    );
  }
  return n;
}

export function assertScheduleEstadoModifiable(
  estado: EstadoResultadoProgramado,
): void {
  if (ESTADOS_NO_MODIFICABLES.has(estado)) {
    throw new ScheduleResultDomainError(
      "SCHEDULE_NOT_MODIFIABLE",
      "No se puede modificar una programación que ya está publicada, cancelada o reemplazada.",
    );
  }
}

export type UpsertPendingScheduleResult = {
  action: "created" | "updated";
  row: ScheduleResultRow;
};

/**
 * Crea o actualiza una selección PENDIENTE para (fecha, hora).
 * - Rechaza si ya existe un Resultado publicado para esa franja.
 * - Rechaza modificar programaciones PUBLICADO / CANCELADO / SUPERSEDED.
 * - Update condicional (id + PENDIENTE); si count≠1 → conflicto concurrente.
 * - No crea Resultado ni cierra venta.
 * - Auditoría solo tras escritura confirmada.
 */
export async function upsertPendingSchedule(
  db: ScheduleResultDb,
  args: UpsertPendingScheduleArgs,
): Promise<UpsertPendingScheduleResult> {
  assertHoraSorteoValida(args.hora);
  const numero = assertNumeroAnimalNoVacio(args.numero);
  const adminUserId = args.adminUserId.trim();
  if (!adminUserId) {
    throw new ScheduleResultDomainError(
      "INVALID_ADMIN",
      "Falta el identificador del administrador.",
    );
  }

  const animal = await db.animal.findUnique({
    where: { numero },
    select: { numero: true },
  });
  if (!animal) {
    throw new ScheduleResultDomainError(
      "ANIMAL_NOT_FOUND",
      "El animal indicado no existe en el catálogo.",
    );
  }

  const fechaStr = fechaAYYYYMMDD(args.fecha);

  try {
    return await db.$transaction(async (tx) => {
      // Releer Resultado dentro de la TX (evita TOCTOU con publicación/cron).
      const published = await tx.resultado.findUnique({
        where: { fecha_hora: { fecha: args.fecha, hora: args.hora } },
        select: { id: true },
      });
      if (published) {
        throw new ScheduleResultDomainError(
          "RESULTADO_ALREADY_PUBLISHED",
          "Ya existe un resultado publicado para esa fecha y hora. Usa la corrección controlada.",
        );
      }

      const existing = await tx.resultadoProgramado.findUnique({
        where: { fecha_hora: { fecha: args.fecha, hora: args.hora } },
        select: {
          id: true,
          fecha: true,
          hora: true,
          numero: true,
          estado: true,
          resultadoId: true,
          createdById: true,
        },
      });

      if (!existing) {
        const created = await tx.resultadoProgramado.create({
          data: {
            fecha: args.fecha,
            hora: args.hora,
            numero,
            estado: "PENDIENTE",
            createdById: adminUserId,
          },
          select: {
            id: true,
            fecha: true,
            hora: true,
            numero: true,
            estado: true,
            resultadoId: true,
            createdById: true,
          },
        });

        await recordAuditEvent(tx, {
          usuarioId: adminUserId,
          accion: "PROGRAMAR_RESULTADO",
          entidad: "RESULTADO_PROGRAMADO",
          entidadId: created.id,
          detalle: {
            fecha: fechaStr,
            hora: args.hora,
            numeroAnterior: null,
            numeroNuevo: numero,
            estado: "PENDIENTE",
          },
        });

        return { action: "created" as const, row: created };
      }

      assertScheduleEstadoModifiable(existing.estado);

      if (existing.numero === numero) {
        return { action: "updated" as const, row: existing };
      }

      const numeroAnterior = existing.numero;
      const linked = await tx.resultadoProgramado.updateMany({
        where: { id: existing.id, estado: "PENDIENTE" },
        data: { numero },
      });
      if (linked.count !== 1) {
        throw new ScheduleResultDomainError(
          "SCHEDULE_NOT_MODIFIABLE",
          "No se puede modificar una programación que ya está publicada, cancelada o reemplazada.",
        );
      }

      const row: ScheduleResultRow = {
        ...existing,
        numero,
        estado: "PENDIENTE",
      };

      await recordAuditEvent(tx, {
        usuarioId: adminUserId,
        accion: "MODIFICAR_PROGRAMACION",
        entidad: "RESULTADO_PROGRAMADO",
        entidadId: existing.id,
        detalle: {
          fecha: fechaStr,
          hora: args.hora,
          numeroAnterior,
          numeroNuevo: numero,
          estado: "PENDIENTE",
        },
      });

      return { action: "updated" as const, row };
    });
  } catch (error) {
    if (error instanceof ScheduleResultDomainError) throw error;
    if (!isUniqueViolation(error)) throw error;

    const targetKind = classifyP2002Target(error);
    // Solo colisión de franja (fecha,hora) de programación o evidencia de filas.
    const peerResultado = await db.resultado.findUnique({
      where: { fecha_hora: { fecha: args.fecha, hora: args.hora } },
      select: { id: true },
    });
    if (peerResultado) {
      throw new ScheduleResultDomainError(
        "RESULTADO_ALREADY_PUBLISHED",
        "Ya existe un resultado publicado para esa fecha y hora. Usa la corrección controlada.",
      );
    }

    const peerSchedule = await db.resultadoProgramado.findUnique({
      where: { fecha_hora: { fecha: args.fecha, hora: args.hora } },
      select: { id: true, estado: true },
    });

    if (targetKind === "other") {
      throw error;
    }

    if (
      targetKind === "slot" ||
      (targetKind === "unknown" && peerSchedule != null)
    ) {
      if (peerSchedule && peerSchedule.estado !== "PENDIENTE") {
        throw new ScheduleResultDomainError(
          "SCHEDULE_NOT_MODIFIABLE",
          "No se puede modificar una programación que ya está publicada, cancelada o reemplazada.",
        );
      }
      throw new ScheduleResultDomainError(
        "SCHEDULE_CONFLICT",
        "Otro proceso ya programó esta fecha y hora. Recarga e inténtalo de nuevo.",
      );
    }

    // unknown sin evidencia de franja: no asumir carrera; propagar.
    throw error;
  }
}

/**
 * Cancela una programación solo si sigue PENDIENTE (updateMany condicional).
 */
export async function cancelPendingSchedule(
  db: ScheduleResultDb,
  args: CancelPendingScheduleArgs,
): Promise<ScheduleResultRow> {
  assertHoraSorteoValida(args.hora);
  const adminUserId = args.adminUserId.trim();
  if (!adminUserId) {
    throw new ScheduleResultDomainError(
      "INVALID_ADMIN",
      "Falta el identificador del administrador.",
    );
  }

  const fechaStr = fechaAYYYYMMDD(args.fecha);

  return db.$transaction(async (tx) => {
    const existing = await tx.resultadoProgramado.findUnique({
      where: { fecha_hora: { fecha: args.fecha, hora: args.hora } },
      select: {
        id: true,
        fecha: true,
        hora: true,
        numero: true,
        estado: true,
        resultadoId: true,
        createdById: true,
      },
    });

    if (!existing) {
      throw new ScheduleResultDomainError(
        "SCHEDULE_NOT_FOUND",
        "No hay programación para esa fecha y hora.",
      );
    }

    if (existing.estado !== "PENDIENTE") {
      throw new ScheduleResultDomainError(
        "SCHEDULE_NOT_MODIFIABLE",
        "No se puede cancelar una programación que ya está publicada, cancelada o reemplazada.",
      );
    }

    const cancelled = await tx.resultadoProgramado.updateMany({
      where: { id: existing.id, estado: "PENDIENTE" },
      data: { estado: "CANCELADO" },
    });
    if (cancelled.count !== 1) {
      throw new ScheduleResultDomainError(
        "SCHEDULE_NOT_MODIFIABLE",
        "No se puede cancelar una programación que ya está publicada, cancelada o reemplazada.",
      );
    }

    const row: ScheduleResultRow = {
      ...existing,
      estado: "CANCELADO",
    };

    await recordAuditEvent(tx, {
      usuarioId: adminUserId,
      accion: "CANCELAR_PROGRAMACION",
      entidad: "RESULTADO_PROGRAMADO",
      entidadId: existing.id,
      detalle: {
        fecha: fechaStr,
        hora: args.hora,
        numeroAnterior: existing.numero,
        numeroNuevo: null,
        estado: "CANCELADO",
      },
    });

    return row;
  });
}
