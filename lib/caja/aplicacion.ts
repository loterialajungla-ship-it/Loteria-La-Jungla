/**
 * Distribución FIFO de confirmaciones sobre obligaciones (C5).
 * Orden: Ticket.createdAt ASC, Ticket.id ASC.
 * Locks (tras Usuario(vendedor) → Declaracion):
 *   Confirmacion FOR UPDATE → obligaciones del vendedor FOR UPDATE (FIFO).
 * Alineado con trigger cupos: Confirmacion → Obligacion.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CajaValidationError } from "@/lib/caja/errors";
import { cajaZero, moneyFixed2, roundHalfUp2 } from "@/lib/caja/money";
import type {
  CajaAplicacionView,
  CajaObligacionSaldoView,
} from "@/lib/caja/types";

export type AplicacionDb = Pick<
  PrismaClient,
  "cajaAplicacion" | "cajaObligacion" | "cajaConfirmacion" | "$queryRaw"
>;

function newAplicacionId(): string {
  return `cja_${randomBytes(12).toString("hex")}`;
}

export function mapAplicacion(row: {
  id: string;
  confirmacionId: string;
  obligacionId: string;
  vendedorId: string;
  importeAplicado: Prisma.Decimal;
  createdAt: Date;
}): CajaAplicacionView {
  return {
    id: row.id,
    confirmacionId: row.confirmacionId,
    obligacionId: row.obligacionId,
    vendedorId: row.vendedorId,
    importeAplicado: roundHalfUp2(row.importeAplicado),
    createdAt: row.createdAt,
  };
}

type ObligacionFifoRow = {
  id: string;
  ticketId: string;
  vendedorId: string;
  importeAdmin: Prisma.Decimal;
  ticketCreatedAt: Date;
};

/**
 * Bloquea la confirmación FOR UPDATE antes de las obligaciones.
 * Alinea el servicio con el orden del trigger (Confirmacion → Obligacion)
 * y evita deadlock con INSERT concurrentes que entren por el trigger.
 */
export async function lockConfirmacionForUpdate(
  tx: Pick<PrismaClient, "$queryRaw">,
  confirmacionId: string,
): Promise<{ id: string; importeConfirmado: Prisma.Decimal }> {
  const id = confirmacionId.trim();
  if (!id) {
    throw new CajaValidationError("confirmacionId requerido.");
  }
  const rows = await tx.$queryRaw<
    Array<{ id: string; importeConfirmado: Prisma.Decimal }>
  >`
    SELECT id, "importeConfirmado"
    FROM "CajaConfirmacion"
    WHERE id = ${id}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new CajaValidationError(
      "Confirmación no encontrada para FIFO.",
      "CAJA_CONFIRMACION_NO_ENCONTRADA",
    );
  }
  return row;
}

/**
 * Bloquea todas las obligaciones del vendedor en orden FIFO determinista.
 * Debe llamarse dentro de TX tras Usuario(vendedor) y Confirmacion FOR UPDATE.
 */
export async function lockObligacionesFifoForUpdate(
  tx: Pick<PrismaClient, "$queryRaw">,
  vendedorId: string,
): Promise<ObligacionFifoRow[]> {
  const id = vendedorId.trim();
  return tx.$queryRaw<ObligacionFifoRow[]>`
    SELECT
      o.id,
      o."ticketId",
      o."vendedorId",
      o."importeAdmin",
      t."createdAt" AS "ticketCreatedAt"
    FROM "CajaObligacion" o
    INNER JOIN "Ticket" t ON t.id = o."ticketId"
    WHERE o."vendedorId" = ${id}
    ORDER BY t."createdAt" ASC, t.id ASC
    FOR UPDATE OF o
  `;
}

export async function sumAplicadoObligacion(
  db: Pick<PrismaClient, "cajaAplicacion">,
  obligacionId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaAplicacion.aggregate({
    where: { obligacionId },
    _sum: { importeAplicado: true },
  });
  return agg._sum.importeAplicado == null
    ? cajaZero()
    : roundHalfUp2(new Prisma.Decimal(agg._sum.importeAplicado));
}

export async function sumAplicadoConfirmacion(
  db: Pick<PrismaClient, "cajaAplicacion">,
  confirmacionId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaAplicacion.aggregate({
    where: { confirmacionId },
    _sum: { importeAplicado: true },
  });
  return agg._sum.importeAplicado == null
    ? cajaZero()
    : roundHalfUp2(new Prisma.Decimal(agg._sum.importeAplicado));
}

export async function sumAplicadoVendedor(
  db: Pick<PrismaClient, "cajaAplicacion">,
  vendedorId: string,
): Promise<Prisma.Decimal> {
  const agg = await db.cajaAplicacion.aggregate({
    where: { vendedorId },
    _sum: { importeAplicado: true },
  });
  return agg._sum.importeAplicado == null
    ? cajaZero()
    : roundHalfUp2(new Prisma.Decimal(agg._sum.importeAplicado));
}

/**
 * Pure FIFO plan: dado importe disponible y saldos pendientes ordenados.
 * No crea filas; útil en unit tests.
 */
export function planFifoAplicaciones(args: {
  importeDisponible: Prisma.Decimal;
  pendientes: Array<{ obligacionId: string; pendiente: Prisma.Decimal }>;
}): Array<{ obligacionId: string; importeAplicar: Prisma.Decimal }> {
  let disponible = roundHalfUp2(args.importeDisponible);
  const out: Array<{ obligacionId: string; importeAplicar: Prisma.Decimal }> =
    [];
  for (const row of args.pendientes) {
    if (disponible.lte(0)) break;
    const pend = roundHalfUp2(row.pendiente);
    if (pend.lte(0)) continue;
    const aplicar = disponible.lte(pend) ? disponible : pend;
    if (aplicar.lte(0)) continue;
    out.push({
      obligacionId: row.obligacionId,
      importeAplicar: roundHalfUp2(aplicar),
    });
    disponible = roundHalfUp2(disponible.minus(aplicar));
  }
  if (disponible.gt(0)) {
    throw new CajaValidationError(
      `No hay obligaciones pendientes suficientes para distribuir ${moneyFixed2(disponible)} restantes.`,
      "CAJA_FIFO_INSUFICIENTE",
    );
  }
  return out;
}

/**
 * Dentro de TX: lock Confirmacion → obligaciones FIFO → insertar aplicaciones.
 * Orden alineado con el trigger (Confirmacion → Obligacion) para evitar deadlocks.
 * La suma aplicada debe coincidir exactamente con importeConfirmado.
 */
export async function distribuirConfirmacionFifoEnTx(
  tx: AplicacionDb,
  args: {
    confirmacionId: string;
    vendedorId: string;
    importeConfirmado: Prisma.Decimal;
    ahora?: Date;
  },
): Promise<CajaAplicacionView[]> {
  const importe = roundHalfUp2(args.importeConfirmado);
  if (importe.lte(0)) {
    throw new CajaValidationError(
      "Importe de confirmación inválido para FIFO.",
      "CAJA_FIFO_IMPORTE_INVALIDO",
    );
  }

  // Confirmacion FOR UPDATE antes de obligaciones (mismo orden que el trigger).
  await lockConfirmacionForUpdate(tx, args.confirmacionId);

  const obligaciones = await lockObligacionesFifoForUpdate(
    tx,
    args.vendedorId,
  );

  const pendientes: Array<{
    obligacionId: string;
    pendiente: Prisma.Decimal;
  }> = [];

  for (const o of obligaciones) {
    if (o.vendedorId !== args.vendedorId) {
      throw new CajaValidationError(
        "Inconsistencia de vendedor en obligación bloqueada.",
        "CAJA_FIFO_VENDEDOR_MISMATCH",
      );
    }
    const ya = await sumAplicadoObligacion(tx, o.id);
    const pendiente = roundHalfUp2(
      roundHalfUp2(o.importeAdmin).minus(ya),
    );
    if (pendiente.gt(0)) {
      pendientes.push({ obligacionId: o.id, pendiente });
    }
  }

  const plan = planFifoAplicaciones({
    importeDisponible: importe,
    pendientes,
  });

  const ahora = args.ahora ?? new Date();
  const created: CajaAplicacionView[] = [];

  for (const step of plan) {
    const row = await tx.cajaAplicacion.create({
      data: {
        id: newAplicacionId(),
        confirmacionId: args.confirmacionId,
        obligacionId: step.obligacionId,
        vendedorId: args.vendedorId,
        importeAplicado: step.importeAplicar,
        createdAt: ahora,
      },
    });
    created.push(mapAplicacion(row));
  }

  const suma = created.reduce(
    (acc, a) => acc.plus(a.importeAplicado),
    cajaZero(),
  );
  if (!roundHalfUp2(suma).eq(importe)) {
    throw new CajaValidationError(
      "La distribución FIFO no cubre exactamente el importe confirmado.",
      "CAJA_FIFO_SUMA_MISMATCH",
    );
  }

  return created;
}

export async function listAplicacionesConfirmacion(
  db: Pick<PrismaClient, "cajaAplicacion">,
  confirmacionId: string,
): Promise<CajaAplicacionView[]> {
  const rows = await db.cajaAplicacion.findMany({
    where: { confirmacionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapAplicacion);
}

export async function listAplicacionesObligacion(
  db: Pick<PrismaClient, "cajaAplicacion">,
  obligacionId: string,
): Promise<CajaAplicacionView[]> {
  const rows = await db.cajaAplicacion.findMany({
    where: { obligacionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapAplicacion);
}

export async function listAplicacionesVendedor(
  db: Pick<PrismaClient, "cajaAplicacion">,
  vendedorId: string,
): Promise<CajaAplicacionView[]> {
  const rows = await db.cajaAplicacion.findMany({
    where: { vendedorId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapAplicacion);
}

export async function listSaldosObligacionesVendedor(
  db: Pick<
    PrismaClient,
    "cajaObligacion" | "cajaAplicacion" | "$queryRaw"
  >,
  vendedorId: string,
): Promise<CajaObligacionSaldoView[]> {
  const id = vendedorId.trim();
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      ticketId: string;
      vendedorId: string;
      bruto: Prisma.Decimal;
      comisionPorcentaje: Prisma.Decimal;
      comisionImporte: Prisma.Decimal;
      importeAdmin: Prisma.Decimal;
      ticketCreatedAt: Date;
    }>
  >`
    SELECT
      o.id,
      o."ticketId",
      o."vendedorId",
      o.bruto,
      o."comisionPorcentaje",
      o."comisionImporte",
      o."importeAdmin",
      t."createdAt" AS "ticketCreatedAt"
    FROM "CajaObligacion" o
    INNER JOIN "Ticket" t ON t.id = o."ticketId"
    WHERE o."vendedorId" = ${id}
    ORDER BY t."createdAt" ASC, t.id ASC
  `;

  const out: CajaObligacionSaldoView[] = [];
  for (const o of rows) {
    const totalAplicado = await sumAplicadoObligacion(db, o.id);
    const importeAdmin = roundHalfUp2(o.importeAdmin);
    const pendiente = roundHalfUp2(importeAdmin.minus(totalAplicado));
    out.push({
      obligacionId: o.id,
      ticketId: o.ticketId,
      ticketCreatedAt: o.ticketCreatedAt,
      vendedorId: o.vendedorId,
      bruto: roundHalfUp2(o.bruto),
      comisionPorcentaje: roundHalfUp2(o.comisionPorcentaje),
      comisionImporte: roundHalfUp2(o.comisionImporte),
      importeAdmin,
      totalAplicado,
      pendiente: pendiente.gt(0) ? pendiente : cajaZero(),
    });
  }
  return out;
}
