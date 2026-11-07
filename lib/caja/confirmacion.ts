/**
 * Confirmaciones de recepción de Caja por ADMIN (C4) + distribución FIFO (C5).
 * Locks: Usuario(vendedor) → CajaDeclaracion → CajaConfirmacion →
 * CajaObligacion (FIFO) FOR UPDATE.
 * Confirmación y aplicaciones en una sola transacción.
 * El lock de Confirmacion antes de Obligaciones evita deadlock con el trigger
 * (orden trigger: Confirmacion → Obligacion).
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  distribuirConfirmacionFifoEnTx,
  listAplicacionesConfirmacion,
} from "@/lib/caja/aplicacion";
import { lockVendedorUsuarioForUpdate } from "@/lib/caja/comision";
import {
  CajaForbiddenError,
  CajaIdempotencyConflictError,
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import {
  cajaZero,
  moneyFixed2,
  parseImporteCajaPositivo,
  roundHalfUp2,
} from "@/lib/caja/money";
import { estadoDeclaracion, sumConfirmadoDeclaracion } from "@/lib/caja/resumen";
import type {
  CajaAplicacionView,
  CajaConfirmacionView,
  CajaDeclaracionView,
} from "@/lib/caja/types";
import { validarIdempotencyKey } from "@/lib/tickets/idempotency";

export type ConfirmacionDb = Pick<
  PrismaClient,
  | "cajaConfirmacion"
  | "cajaDeclaracion"
  | "cajaObligacion"
  | "cajaAplicacion"
  | "usuario"
  | "auditoria"
  | "$transaction"
  | "$queryRaw"
>;

function newConfirmacionId(): string {
  return `cjc_${randomBytes(12).toString("hex")}`;
}

export function hashConfirmacionRequest(args: {
  declaracionId: string;
  importe: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        declaracionId: args.declaracionId,
        importe: args.importe,
      }),
    )
    .digest("hex");
}

type DeclaracionLockRow = {
  id: string;
  vendedorId: string;
  importeDeclarado: Prisma.Decimal;
  declaradoAt: Date;
  nota: string | null;
};

async function lockDeclaracionForUpdate(
  tx: Pick<PrismaClient, "$queryRaw">,
  declaracionId: string,
): Promise<DeclaracionLockRow> {
  const id = declaracionId.trim();
  if (!id) {
    throw new CajaValidationError("declaracionId requerido.");
  }
  const rows = await tx.$queryRaw<DeclaracionLockRow[]>`
    SELECT id, "vendedorId", "importeDeclarado", "declaradoAt", nota
    FROM "CajaDeclaracion"
    WHERE id = ${id}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new CajaNotFoundError(
      "Declaración no encontrada.",
      "CAJA_DECLARACION_NO_ENCONTRADA",
    );
  }
  return row;
}

async function assertAdminActor(
  db: Pick<PrismaClient, "usuario">,
  actorAdminId: string,
): Promise<string> {
  const id = actorAdminId.trim();
  if (!id) {
    throw new CajaValidationError("actorAdminId requerido.");
  }
  const admin = await db.usuario.findUnique({
    where: { id },
    select: { id: true, rol: true, activo: true },
  });
  if (!admin || !admin.activo || admin.rol !== "ADMIN") {
    throw new CajaForbiddenError(
      "Solo un administrador activo puede confirmar entregas de Caja.",
      "CAJA_SOLO_ADMIN",
    );
  }
  return admin.id;
}

function mapConfirmacion(row: {
  id: string;
  declaracionId: string;
  importeConfirmado: Prisma.Decimal;
  confirmadoPorAdminId: string;
  confirmadoAt: Date;
}): CajaConfirmacionView {
  return {
    id: row.id,
    declaracionId: row.declaracionId,
    importeConfirmado: roundHalfUp2(row.importeConfirmado),
    confirmadoPorAdminId: row.confirmadoPorAdminId,
    confirmadoAt: row.confirmadoAt,
  };
}

function mapDeclaracionFromLock(
  row: DeclaracionLockRow,
  totalConfirmado: Prisma.Decimal,
): CajaDeclaracionView {
  const importeDeclarado = roundHalfUp2(row.importeDeclarado);
  const conf = roundHalfUp2(totalConfirmado);
  const pendiente = roundHalfUp2(importeDeclarado.minus(conf));
  return {
    id: row.id,
    vendedorId: row.vendedorId,
    importeDeclarado,
    declaradoAt: row.declaradoAt,
    nota: row.nota,
    totalConfirmado: conf,
    pendienteConfirmar: pendiente.gt(0) ? pendiente : cajaZero(),
    estado: estadoDeclaracion({ importeDeclarado, totalConfirmado: conf }),
  };
}

function esConflictoIdempotencyKey(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  if (typeof target === "string") return target.includes("idempotencyKey");
  if (Array.isArray(target)) {
    return target.some((t) => String(t).includes("idempotencyKey"));
  }
  return false;
}

export type CrearConfirmacionResult = {
  confirmacion: CajaConfirmacionView;
  declaracion: CajaDeclaracionView;
  aplicaciones: CajaAplicacionView[];
  idempotentReplay: boolean;
};

async function replayConfirmacion(
  db: ConfirmacionDb,
  existing: {
    id: string;
    declaracionId: string;
    importeConfirmado: Prisma.Decimal;
    confirmadoPorAdminId: string;
    confirmadoAt: Date;
  },
  declaracionId: string,
): Promise<CrearConfirmacionResult> {
  const decl = await db.cajaDeclaracion.findUnique({
    where: { id: declaracionId },
  });
  if (!decl) {
    throw new CajaNotFoundError(
      "Declaración no encontrada.",
      "CAJA_DECLARACION_NO_ENCONTRADA",
    );
  }
  const confSum = await sumConfirmadoDeclaracion(db, declaracionId);
  const aplicaciones = await listAplicacionesConfirmacion(db, existing.id);
  return {
    confirmacion: mapConfirmacion(existing),
    declaracion: mapDeclaracionFromLock(decl, confSum),
    aplicaciones,
    idempotentReplay: true,
  };
}

/**
 * ADMIN confirma total o parcialmente una declaración y aplica FIFO.
 * Orden locks: Usuario(vendedor) → Declaracion → Confirmacion → Obligaciones FIFO.
 */
export async function crearConfirmacionAdmin(
  db: ConfirmacionDb,
  args: {
    actorAdminId: string;
    actorRol: "VENDEDOR" | "ADMIN";
    declaracionId: string;
    importe: Prisma.Decimal | string | number;
    idempotencyKey: unknown;
    ahora?: Date;
  },
): Promise<CrearConfirmacionResult> {
  if (args.actorRol !== "ADMIN") {
    throw new CajaForbiddenError(
      "Solo un administrador puede confirmar entregas de Caja.",
      "CAJA_SOLO_ADMIN",
    );
  }

  const declaracionId = args.declaracionId.trim();
  if (!declaracionId) {
    throw new CajaValidationError("declaracionId requerido.");
  }

  const importe = parseImporteCajaPositivo(args.importe);
  const importeFixed = moneyFixed2(importe);
  const idempotencyKey = validarIdempotencyKey(args.idempotencyKey);
  const requestHash = hashConfirmacionRequest({
    declaracionId,
    importe: importeFixed,
  });
  const ahora = args.ahora ?? new Date();

  const existing = await db.cajaConfirmacion.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.idempotencyRequestHash !== requestHash) {
      throw new CajaIdempotencyConflictError();
    }
    if (existing.declaracionId !== declaracionId) {
      throw new CajaIdempotencyConflictError(
        "Esta clave de operación no puede reutilizarse.",
      );
    }
    return replayConfirmacion(db, existing, declaracionId);
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const actorAdminId = await assertAdminActor(tx, args.actorAdminId);

        const preview = await tx.cajaDeclaracion.findUnique({
          where: { id: declaracionId },
          select: { vendedorId: true },
        });
        if (!preview) {
          throw new CajaNotFoundError(
            "Declaración no encontrada.",
            "CAJA_DECLARACION_NO_ENCONTRADA",
          );
        }

        await lockVendedorUsuarioForUpdate(tx, preview.vendedorId);
        const decl = await lockDeclaracionForUpdate(tx, declaracionId);

        const yaConfirmado = await sumConfirmadoDeclaracion(tx, decl.id);
        const pendiente = roundHalfUp2(
          roundHalfUp2(decl.importeDeclarado).minus(yaConfirmado),
        );
        if (importe.gt(pendiente)) {
          throw new CajaValidationError(
            `El importe supera el pendiente de confirmar (${moneyFixed2(pendiente.gt(0) ? pendiente : cajaZero())}).`,
            "CAJA_SOBRECONFIRMACION",
          );
        }

        const conf = await tx.cajaConfirmacion.create({
          data: {
            id: newConfirmacionId(),
            declaracionId: decl.id,
            importeConfirmado: importe,
            confirmadoPorAdminId: actorAdminId,
            confirmadoAt: ahora,
            idempotencyKey,
            idempotencyRequestHash: requestHash,
          },
        });

        const aplicaciones = await distribuirConfirmacionFifoEnTx(tx, {
          confirmacionId: conf.id,
          vendedorId: decl.vendedorId,
          importeConfirmado: importe,
          ahora,
        });

        await recordAuditEvent(tx, {
          usuarioId: actorAdminId,
          accion: "CREAR_CAJA_CONFIRMACION",
          entidad: "CAJA_CONFIRMACION",
          entidadId: conf.id,
          detalle: {
            declaracionId: decl.id,
            vendedorId: decl.vendedorId,
            importeConfirmado: importeFixed,
            aplicacionesCount: aplicaciones.length,
          },
        });

        const nuevoTotal = roundHalfUp2(yaConfirmado.plus(importe));
        return {
          confirmacion: mapConfirmacion(conf),
          declaracion: mapDeclaracionFromLock(decl, nuevoTotal),
          aplicaciones,
        };
      },
      { maxWait: 30_000, timeout: 60_000 },
    );

    return { ...result, idempotentReplay: false };
  } catch (error) {
    if (!esConflictoIdempotencyKey(error)) throw error;
    const race = await db.cajaConfirmacion.findUnique({
      where: { idempotencyKey },
    });
    if (!race) throw error;
    if (race.idempotencyRequestHash !== requestHash) {
      throw new CajaIdempotencyConflictError();
    }
    if (race.declaracionId !== declaracionId) {
      throw new CajaIdempotencyConflictError(
        "Esta clave de operación no puede reutilizarse.",
      );
    }
    return replayConfirmacion(db, race, declaracionId);
  }
}
