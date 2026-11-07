/**
 * Declaraciones de entrega de Caja (C4).
 * Solo el vendedor declara para sí mismo. Locks: Usuario(vendedor) FOR UPDATE.
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { lockVendedorUsuarioForUpdate } from "@/lib/caja/comision";
import {
  CajaForbiddenError,
  CajaIdempotencyConflictError,
  CajaValidationError,
} from "@/lib/caja/errors";
import {
  moneyFixed2,
  parseImporteCajaPositivo,
  roundHalfUp2,
} from "@/lib/caja/money";
import {
  calcularTotalesCaja,
  estadoDeclaracion,
  sumConfirmadoDeclaracion,
  sumDeclaradoVendedor,
  sumObligadoVendedor,
} from "@/lib/caja/resumen";
import type { CajaDeclaracionView } from "@/lib/caja/types";
import { validarIdempotencyKey } from "@/lib/tickets/idempotency";

export type DeclaracionDb = Pick<
  PrismaClient,
  | "cajaDeclaracion"
  | "cajaObligacion"
  | "cajaConfirmacion"
  | "usuario"
  | "auditoria"
  | "$transaction"
  | "$queryRaw"
>;

function newDeclaracionId(): string {
  return `cjd_${randomBytes(12).toString("hex")}`;
}

export function hashDeclaracionRequest(args: {
  importe: string;
  nota: string | null;
}): string {
  const payload = JSON.stringify({
    importe: args.importe,
    nota: args.nota,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function mapDeclaracionView(
  row: {
    id: string;
    vendedorId: string;
    importeDeclarado: Prisma.Decimal;
    declaradoAt: Date;
    nota: string | null;
  },
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
    pendienteConfirmar: pendiente.gt(0) ? pendiente : roundHalfUp2(new Prisma.Decimal(0)),
    estado: estadoDeclaracion({
      importeDeclarado,
      totalConfirmado: conf,
    }),
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

export type CrearDeclaracionResult = {
  declaracion: CajaDeclaracionView;
  idempotentReplay: boolean;
};

/**
 * Crea una declaración del vendedor autenticado.
 * Dentro de TX: lock Usuario(vendedor) → recalcula totales → valida → inserta.
 */
export async function crearDeclaracionVendedor(
  db: DeclaracionDb,
  args: {
    actorUserId: string;
    actorRol: "VENDEDOR" | "ADMIN";
    importe: Prisma.Decimal | string | number;
    idempotencyKey: unknown;
    nota?: string | null;
    ahora?: Date;
  },
): Promise<CrearDeclaracionResult> {
  if (args.actorRol !== "VENDEDOR") {
    throw new CajaForbiddenError(
      "Solo un vendedor puede declarar entregas de Caja.",
      "CAJA_SOLO_VENDEDOR",
    );
  }

  const vendedorId = args.actorUserId.trim();
  if (!vendedorId) {
    throw new CajaValidationError("actorUserId requerido.");
  }

  const importe = parseImporteCajaPositivo(args.importe);
  const importeFixed = moneyFixed2(importe);
  const notaRaw = args.nota?.trim() || null;
  const nota = notaRaw && notaRaw.length > 0 ? notaRaw.slice(0, 500) : null;
  const idempotencyKey = validarIdempotencyKey(args.idempotencyKey);
  const requestHash = hashDeclaracionRequest({
    importe: importeFixed,
    nota,
  });
  const ahora = args.ahora ?? new Date();

  const existing = await db.cajaDeclaracion.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.vendedorId !== vendedorId) {
      throw new CajaIdempotencyConflictError(
        "Esta clave de operación no puede reutilizarse.",
      );
    }
    if (existing.idempotencyRequestHash !== requestHash) {
      throw new CajaIdempotencyConflictError();
    }
    const conf = await sumConfirmadoDeclaracion(db, existing.id);
    return {
      declaracion: mapDeclaracionView(existing, conf),
      idempotentReplay: true,
    };
  }

  try {
    const created = await db.$transaction(
      async (tx) => {
        await lockVendedorUsuarioForUpdate(tx, vendedorId);

        const [totalObligado, totalDeclarado] = await Promise.all([
          sumObligadoVendedor(tx, vendedorId),
          sumDeclaradoVendedor(tx, vendedorId),
        ]);
        // totalConfirmado no limita la declaración; solo pendiente declarar.
        const totales = calcularTotalesCaja({
          totalObligado,
          totalDeclarado,
          totalConfirmado: roundHalfUp2(new Prisma.Decimal(0)),
        });

        if (importe.gt(totales.maxNuevaDeclaracion)) {
          throw new CajaValidationError(
            `El importe supera el pendiente de declarar (${moneyFixed2(totales.maxNuevaDeclaracion)}).`,
            "CAJA_SOBREDECLARACION",
          );
        }

        const row = await tx.cajaDeclaracion.create({
          data: {
            id: newDeclaracionId(),
            vendedorId,
            importeDeclarado: importe,
            declaradoAt: ahora,
            idempotencyKey,
            idempotencyRequestHash: requestHash,
            nota,
          },
        });

        await recordAuditEvent(tx, {
          usuarioId: vendedorId,
          accion: "CREAR_CAJA_DECLARACION",
          entidad: "CAJA_DECLARACION",
          entidadId: row.id,
          detalle: {
            vendedorId,
            importeDeclarado: importeFixed,
            nota,
          },
        });

        return row;
      },
      { maxWait: 30_000, timeout: 60_000 },
    );

    return {
      declaracion: mapDeclaracionView(
        created,
        roundHalfUp2(new Prisma.Decimal(0)),
      ),
      idempotentReplay: false,
    };
  } catch (error) {
    if (!esConflictoIdempotencyKey(error)) throw error;
    const race = await db.cajaDeclaracion.findUnique({
      where: { idempotencyKey },
    });
    if (!race) throw error;
    if (race.vendedorId !== vendedorId) {
      throw new CajaIdempotencyConflictError(
        "Esta clave de operación no puede reutilizarse.",
      );
    }
    if (race.idempotencyRequestHash !== requestHash) {
      throw new CajaIdempotencyConflictError();
    }
    const conf = await sumConfirmadoDeclaracion(db, race.id);
    return {
      declaracion: mapDeclaracionView(race, conf),
      idempotentReplay: true,
    };
  }
}

export async function listDeclaracionesVendedor(
  db: Pick<PrismaClient, "cajaDeclaracion" | "cajaConfirmacion">,
  vendedorId: string,
): Promise<CajaDeclaracionView[]> {
  const id = vendedorId.trim();
  const rows = await db.cajaDeclaracion.findMany({
    where: { vendedorId: id },
    orderBy: [{ declaradoAt: "desc" }, { id: "desc" }],
  });
  const out: CajaDeclaracionView[] = [];
  for (const r of rows) {
    const conf = await sumConfirmadoDeclaracion(db, r.id);
    out.push(mapDeclaracionView(r, conf));
  }
  return out;
}
