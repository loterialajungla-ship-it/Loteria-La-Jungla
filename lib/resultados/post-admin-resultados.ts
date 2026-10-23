/**
 * Lógica HTTP de POST /api/admin/resultados.
 * Entrada de producción: `postAdminResultados` (deps reales fijas).
 * Tests / cableado interno: `postAdminResultadosWithDeps`.
 */

import { NextResponse } from "next/server";
import type { AdminActor } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { HORAS_SORTEO, parseFechaYYYYMMDD } from "@/lib/fecha";
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
  correctPublishedResult,
  createManualResult,
} from "@/lib/resultados/save-manual";
import type { PrismaClient } from "@prisma/client";

type SaveManualDb = Pick<
  PrismaClient,
  "resultado" | "auditoria" | "$transaction"
>;

type AnimalLookupDb = {
  animal: {
    findUnique: (args: {
      where: { numero: string };
    }) => Promise<{ numero: string; nombre: string } | null>;
    findMany: (args: {
      select: { numero: true; nombre: true };
    }) => Promise<{ numero: string; nombre: string }[]>;
  };
  resultado: {
    findUnique: (args: {
      where: { fecha_hora: { fecha: Date; hora: number } };
      select: { numero: true };
    }) => Promise<{ numero: string } | null>;
  };
};

export type PostAdminResultadosDeps = {
  requireAdmin: () => Promise<AdminActor>;
  /** Lecturas de animal/resultado existentes + cliente para create/correct. */
  prisma: SaveManualDb & AnimalLookupDb;
  createManualResult: typeof createManualResult;
  correctPublishedResult: typeof correctPublishedResult;
};

type ResultadoBody = {
  fecha?: string;
  hora?: number;
  numero?: string;
  confirmCorrection?: unknown;
  motivo?: unknown;
  expectedNumero?: unknown;
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

function jsonDomainError(error: ResultadoDomainError, status: number) {
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
  const numero = typeof body.numero === "string" ? body.numero.trim() : "";

  if (
    !fecha ||
    !(HORAS_SORTEO as readonly number[]).includes(hora) ||
    !numero
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_DATA", message: "Datos inválidos" },
      },
      { status: 400 },
    );
  }

  // Fail-closed HTTP: catálogo canónico antes de mutar.
  // El dominio también revalida (defensa en profundidad).
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
    if (!existing) {
      const created = await deps.createManualResult(deps.prisma, {
        fecha,
        hora,
        numero,
        adminUserId: admin.userId,
      });
      return jsonResultadoOk(created);
    }

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
  });
}
