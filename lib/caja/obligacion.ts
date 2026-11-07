/**
 * Creación de obligaciones de Caja (C3).
 * Solo dentro de la TX de createTicket. Snapshot inmutable de comisión.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type RolUsuario } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  ensureComisionInicialSiAusente,
  type ComisionTx,
} from "@/lib/caja/comision";
import {
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import {
  calcularSplitComision,
  moneyFixed2,
} from "@/lib/caja/money";
import type { CajaObligacionView } from "@/lib/caja/types";

export type ObligacionTx = Pick<
  PrismaClient,
  | "cajaConfig"
  | "cajaObligacion"
  | "vendedorComision"
  | "vendedorComisionHistorial"
  | "usuario"
  | "auditoria"
> &
  Partial<Pick<PrismaClient, "$queryRaw">>;

function newObligacionId(): string {
  return `cob_${randomBytes(12).toString("hex")}`;
}

function mapObligacion(row: {
  id: string;
  ticketId: string;
  vendedorId: string;
  bruto: Prisma.Decimal;
  comisionPorcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
  createdAt: Date;
}): CajaObligacionView {
  return {
    id: row.id,
    ticketId: row.ticketId,
    vendedorId: row.vendedorId,
    bruto: row.bruto,
    comisionPorcentaje: row.comisionPorcentaje,
    comisionImporte: row.comisionImporte,
    importeAdmin: row.importeAdmin,
    createdAt: row.createdAt,
  };
}

/**
 * ¿Debe generarse obligación para este ticket?
 * Caja activa + createdAt ≥ activadaEn + vendedor atribuido (no venta ADMIN directa).
 */
export function debeGenerarObligacion(args: {
  cajaActiva: boolean;
  activadaEn: Date | null;
  ticketCreatedAt: Date;
  /** Rol del usuario al que se atribuye el ticket (Ticket.vendedorId). */
  ticketVendedorRol: RolUsuario | null;
}): boolean {
  if (!args.cajaActiva || args.activadaEn == null) return false;
  if (args.ticketVendedorRol !== "VENDEDOR") return false;
  // Inclusión: createdAt >= activadaEn (instantes absolutos).
  return args.ticketCreatedAt.getTime() >= args.activadaEn.getTime();
}

/**
 * Valida un vendedorId para atribución ADMIN → VENDEDOR activo.
 */
export async function assertVendedorElegibleParaAtribucion(
  db: Pick<PrismaClient, "usuario">,
  vendedorId: string,
): Promise<{ id: string; rol: "VENDEDOR"; activo: true }> {
  const id = vendedorId.trim();
  if (!id) {
    throw new CajaValidationError(
      "vendedorId de atribución requerido.",
      "CAJA_ATRIBUCION_INVALIDA",
    );
  }
  const user = await db.usuario.findUnique({
    where: { id },
    select: { id: true, rol: true, activo: true },
  });
  if (!user) {
    throw new CajaNotFoundError(
      "Vendedor de atribución no encontrado.",
      "CAJA_VENDEDOR_NO_ENCONTRADO",
    );
  }
  if (user.rol !== "VENDEDOR") {
    throw new CajaValidationError(
      "Solo se puede atribuir la venta a un usuario con rol VENDEDOR.",
      "CAJA_ATRIBUCION_NO_VENDEDOR",
    );
  }
  if (!user.activo) {
    throw new CajaValidationError(
      "El vendedor de atribución está inactivo.",
      "CAJA_ATRIBUCION_INACTIVO",
    );
  }
  return { id: user.id, rol: "VENDEDOR", activo: true };
}

/**
 * Crea la obligación si el ticket es elegible. Misma TX que el ticket.
 * Si Caja activa y falta comisión → ensure 20 % (C2). Si no se puede
 * determinar comisión de forma segura → lanza (rollback).
 *
 * No genera obligación si Caja inactiva, ticket anterior al corte,
 * o Ticket.vendedorId no es VENDEDOR (venta ADMIN directa).
 */
export async function maybeCreateCajaObligacionEnTx(
  tx: ObligacionTx,
  args: {
    ticketId: string;
    /** Usuario en Ticket.vendedorId (atribuido o emisor). */
    ticketVendedorId: string;
    bruto: Prisma.Decimal;
    ticketCreatedAt: Date;
    /** Actor de la emisión (auditoría). */
    actorUserId: string;
    /** Admin de sesión si aplica (para ensure comisión). */
    actorAdminId: string | null;
    ahora?: Date;
  },
): Promise<CajaObligacionView | null> {
  const ticketVendedorId = args.ticketVendedorId.trim();
  if (!ticketVendedorId) {
    return null;
  }

  const config = await tx.cajaConfig.findUnique({ where: { id: 1 } });
  if (!config?.activa || config.activadaEn == null) {
    return null;
  }

  const vendedor = await tx.usuario.findUnique({
    where: { id: ticketVendedorId },
    select: { id: true, rol: true, activo: true },
  });
  if (!vendedor || vendedor.rol !== "VENDEDOR") {
    return null;
  }

  if (
    !debeGenerarObligacion({
      cajaActiva: config.activa,
      activadaEn: config.activadaEn,
      ticketCreatedAt: args.ticketCreatedAt,
      ticketVendedorRol: vendedor.rol,
    })
  ) {
    return null;
  }

  if (!vendedor.activo) {
    throw new CajaValidationError(
      "No se puede generar obligación para un vendedor inactivo.",
      "CAJA_VENDEDOR_INACTIVO",
    );
  }

  // Snapshot bajo FOR UPDATE de VendedorComision (Usuario(vend) ya bloqueado
  // en createTicket: emisor=vend o atribución). Serializa vs setComision.
  const comisionTx = tx as ComisionTx;
  const { comision } = await ensureComisionInicialSiAusente(comisionTx, {
    vendedorId: ticketVendedorId,
    actorAdminId: args.actorAdminId,
    ahora: args.ahora,
    motivo: "Alta inicial al emitir ticket elegible (Caja activa, 20 %)",
    // Usuario ya validado/bloqueado arriba; evitar doble lectura sin lock.
    validarVendedor: false,
    bloquear: true,
  });

  const split = calcularSplitComision(args.bruto, comision.porcentaje);
  const id = newObligacionId();

  let created;
  try {
    created = await tx.cajaObligacion.create({
      data: {
        id,
        ticketId: args.ticketId,
        vendedorId: ticketVendedorId,
        bruto: split.bruto,
        comisionPorcentaje: split.porcentaje,
        comisionImporte: split.comisionImporte,
        importeAdmin: split.importeAdmin,
        createdAt: args.ahora ?? args.ticketCreatedAt,
      },
    });
  } catch (error) {
    // Unicidad ticketId: no convertir en éxito silencioso fuera de replay
    // de createTicket (el ticket nuevo no debería chocar). Propagar.
    throw error;
  }

  await recordAuditEvent(tx, {
    usuarioId: args.actorUserId,
    accion: "CREAR_CAJA_OBLIGACION",
    entidad: "CAJA_OBLIGACION",
    entidadId: created.id,
    detalle: {
      ticketId: args.ticketId,
      vendedorId: ticketVendedorId,
      bruto: moneyFixed2(split.bruto),
      comisionPorcentaje: moneyFixed2(split.porcentaje),
      comisionImporte: moneyFixed2(split.comisionImporte),
      importeAdmin: moneyFixed2(split.importeAdmin),
    },
  });

  return mapObligacion(created);
}
