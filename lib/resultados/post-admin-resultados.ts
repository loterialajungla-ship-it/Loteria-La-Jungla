/**
 * Lógica HTTP de POST /api/admin/resultados.
 * Entrada de producción: `postAdminResultados` (deps reales fijas).
 * Tests / cableado interno: `postAdminResultadosWithDeps`.
 *
 * Guardar:
 * - franja futura sin Resultado → programación PENDIENTE
 * - franja vencida sin Resultado → publicación MANUAL inmediata
 * - Resultado existente → corrección controlada (sin cambio)
 * Cancelar programación: body.action === "cancelProgramacion"
 */

import { NextResponse } from "next/server";
import type { AdminActor } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import {
  esFranjaFutura,
  HORAS_SORTEO,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import {
  CatalogoAnimalitosInvalidoError,
  assertCanonicalAnimalCatalog,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  ResultadoCorrectionConflictError,
  ResultadoCorrectionRequiredError,
  ResultadoCorrectionValidationError,
  ResultadoDomainError,
  type CorrectPublishedResultArgs,
  type SaveManualDb,
  correctPublishedResult,
  createManualResult,
} from "@/lib/resultados/save-manual";
import {
  ScheduleResultDomainError,
  cancelPendingSchedule,
  upsertPendingSchedule,
  type ScheduleResultDb,
} from "@/lib/resultados/schedule-result";

export type PostAdminResultadosDeps = {
  requireAdmin: () => Promise<AdminActor>;
  /** Lecturas + mutaciones de resultado/programación. */
  prisma: SaveManualDb;
  createManualResult: typeof createManualResult;
  correctPublishedResult: typeof correctPublishedResult;
  upsertPendingSchedule: typeof upsertPendingSchedule;
  cancelPendingSchedule: typeof cancelPendingSchedule;
  /** Inyectable en tests (zona Caracas). */
  ahora?: Date;
};

type ResultadoBody = {
  fecha?: string;
  hora?: number;
  numero?: string;
  confirmCorrection?: unknown;
  motivo?: unknown;
  expectedNumero?: unknown;
  /** "cancelProgramacion" cancela una PENDIENTE. */
  action?: unknown;
};

function jsonResultadoOk(resultado: {
  hora: number;
  numero: string;
  animal: { nombre: string };
  origen: "MANUAL";
}) {
  return NextResponse.json({
    ok: true,
    resultado: {
      hora: resultado.hora,
      numero: resultado.numero,
      nombre: resultado.animal.nombre,
      origen: resultado.origen,
    },
  });
}

function jsonProgramacionOk(args: {
  action: "created" | "updated" | "cancelled";
  hora: number;
  numero: string;
  nombre: string;
  estado: string;
}) {
  return NextResponse.json({
    ok: true,
    programacion: {
      action: args.action,
      hora: args.hora,
      numero: args.numero,
      nombre: args.nombre,
      estado: args.estado,
    },
  });
}

function jsonDomainError(
  error: ResultadoDomainError | ScheduleResultDomainError,
  status: number,
) {
  const body: {
    ok: false;
    error: { code: string; message: string; currentNumero?: string };
  } = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (
    error instanceof ResultadoCorrectionConflictError ||
    error instanceof ResultadoCorrectionRequiredError
  ) {
    if (error.currentNumero) {
      body.error.currentNumero = error.currentNumero;
    }
  }
  return NextResponse.json(body, { status });
}

function scheduleErrorStatus(error: ScheduleResultDomainError): number {
  if (
    error.code === "SCHEDULE_NOT_MODIFIABLE" ||
    error.code === "RESULTADO_ALREADY_PUBLISHED" ||
    error.code === "SCHEDULE_NOT_FOUND" ||
    error.code === "SCHEDULE_CONFLICT"
  ) {
    return 409;
  }
  return 400;
}

/**
 * @internal Destinada a pruebas aisladas y al cableado interno de
 * `postAdminResultados`. No usar desde rutas Next ni otros entrypoints de
 * producción: pasar deps ficticias omitiría la autorización real.
 */
export async function postAdminResultadosWithDeps(
  request: Request,
  deps: PostAdminResultadosDeps,
): Promise<NextResponse> {
  let admin: AdminActor;
  try {
    admin = await deps.requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  let body: ResultadoBody;
  try {
    body = (await request.json()) as ResultadoBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_JSON", message: "Datos inválidos" },
      },
      { status: 400 },
    );
  }

  const fecha =
    typeof body.fecha === "string" ? parseFechaYYYYMMDD(body.fecha) : null;
  const hora = Number(body.hora);
  const ahora = deps.ahora ?? new Date();
  const action =
    typeof body.action === "string" ? body.action.trim() : undefined;

  if (!fecha || !(HORAS_SORTEO as readonly number[]).includes(hora)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_DATA", message: "Datos inválidos" },
      },
      { status: 400 },
    );
  }

  // Cancelación de programación pendiente (sin número obligatorio).
  if (action === "cancelProgramacion") {
    try {
      const row = await deps.cancelPendingSchedule(
        deps.prisma as ScheduleResultDb,
        {
          fecha,
          hora,
          adminUserId: admin.userId,
        },
      );
      const catalogRows = await deps.prisma.animal.findMany({
        select: { numero: true, nombre: true },
      });
      const nombre =
        catalogRows.find((a) => a.numero === row.numero)?.nombre ?? row.numero;
      return jsonProgramacionOk({
        action: "cancelled",
        hora: row.hora,
        numero: row.numero,
        nombre,
        estado: row.estado,
      });
    } catch (error) {
      if (error instanceof ScheduleResultDomainError) {
        return jsonDomainError(error, scheduleErrorStatus(error));
      }
      console.error("[api/admin/resultados] cancel", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "No se pudo cancelar la programación.",
          },
        },
        { status: 500 },
      );
    }
  }

  const numero = typeof body.numero === "string" ? body.numero.trim() : "";
  if (!numero) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_DATA", message: "Datos inválidos" },
      },
      { status: 400 },
    );
  }

  // Fail-closed HTTP: catálogo canónico antes de mutar.
  try {
    const catalogRows = await deps.prisma.animal.findMany({
      select: { numero: true, nombre: true },
    });
    assertCanonicalAnimalCatalog(catalogRows);
  } catch (error) {
    if (error instanceof CatalogoAnimalitosInvalidoError) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: error.code, message: error.message },
        },
        { status: 400 },
      );
    }
    throw error;
  }

  const animal = await deps.prisma.animal.findUnique({ where: { numero } });
  if (!animal) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ANIMAL_NOT_FOUND",
          message: "Animal no encontrado",
        },
      },
      { status: 400 },
    );
  }

  const existing = await deps.prisma.resultado.findUnique({
    where: { fecha_hora: { fecha, hora } },
    select: { numero: true },
  });

  try {
    if (existing) {
      if (body.confirmCorrection !== true) {
        return jsonDomainError(
          new ResultadoCorrectionRequiredError(
            "Ya existe un resultado para esa fecha y hora. Confirma la corrección e indica un motivo.",
            existing.numero,
          ),
          409,
        );
      }

      const corrected = await deps.correctPublishedResult(deps.prisma, {
        fecha,
        hora,
        numero,
        adminUserId: admin.userId,
        confirmCorrection: body.confirmCorrection,
        motivo: body.motivo,
        expectedNumero: body.expectedNumero,
      } satisfies CorrectPublishedResultArgs);
      return jsonResultadoOk(corrected);
    }

    // Sin Resultado publicado: futuro → programar; vencida → publicar ya.
    if (esFranjaFutura(fecha, hora, ahora)) {
      const scheduled = await deps.upsertPendingSchedule(
        deps.prisma as ScheduleResultDb,
        {
          fecha,
          hora,
          numero,
          adminUserId: admin.userId,
        },
      );
      return jsonProgramacionOk({
        action: scheduled.action,
        hora: scheduled.row.hora,
        numero: scheduled.row.numero,
        nombre: animal.nombre,
        estado: scheduled.row.estado,
      });
    }

    const created = await deps.createManualResult(deps.prisma, {
      fecha,
      hora,
      numero,
      adminUserId: admin.userId,
    });
    return jsonResultadoOk(created);
  } catch (error) {
    if (error instanceof CatalogoAnimalitosInvalidoError) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: error.code, message: error.message },
        },
        { status: 400 },
      );
    }
    if (error instanceof ScheduleResultDomainError) {
      return jsonDomainError(error, scheduleErrorStatus(error));
    }
    if (error instanceof ResultadoCorrectionValidationError) {
      return jsonDomainError(error, 400);
    }
    if (error instanceof ResultadoCorrectionConflictError) {
      return jsonDomainError(error, 409);
    }
    if (error instanceof ResultadoCorrectionRequiredError) {
      return jsonDomainError(error, 409);
    }
    if (error instanceof ResultadoDomainError) {
      return jsonDomainError(error, 400);
    }
    console.error("[api/admin/resultados]", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "No se pudo guardar el resultado.",
        },
      },
      { status: 500 },
    );
  }
}

/**
 * Entrada de producción para POST /api/admin/resultados.
 * Siempre usa `requireAdmin`, Prisma y el dominio reales.
 * No acepta dependencias alternativas.
 *
 * Imports dinámicos: evita que cargar `WithDeps` en tests inicialice Prisma.
 */
export async function postAdminResultados(
  request: Request,
): Promise<NextResponse> {
  const { requireAdmin } = await import("@/lib/auth/guards");
  const { prisma } = await import("@/lib/prisma");
  return postAdminResultadosWithDeps(request, {
    requireAdmin,
    prisma,
    createManualResult,
    correctPublishedResult,
    upsertPendingSchedule,
    cancelPendingSchedule,
  });
}
