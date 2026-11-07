/**
 * Configuración singleton de Caja (independiente de créditos).
 */
import type { PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import { CajaForbiddenError, CajaValidationError } from "@/lib/caja/errors";
import {
  ensureComisionInicialSiAusente,
} from "@/lib/caja/comision";
import type { ActivarCajaResult, CajaConfigView } from "@/lib/caja/types";

export type CajaConfigDb = Pick<
  PrismaClient,
  | "cajaConfig"
  | "vendedorComision"
  | "vendedorComisionHistorial"
  | "usuario"
  | "auditoria"
  | "$transaction"
>;

function mapConfig(row: {
  activa: boolean;
  activadaEn: Date | null;
  activadaPorAdminId: string | null;
  updatedAt: Date;
} | null): CajaConfigView {
  if (!row) {
    return {
      activa: false,
      activadaEn: null,
      activadaPorAdminId: null,
      updatedAt: new Date(0),
      configPersisted: false,
    };
  }
  return {
    activa: row.activa,
    activadaEn: row.activadaEn,
    activadaPorAdminId: row.activadaPorAdminId,
    updatedAt: row.updatedAt,
    configPersisted: true,
  };
}

export async function getCajaConfig(db: CajaConfigDb): Promise<CajaConfigView> {
  const row = await db.cajaConfig.findUnique({ where: { id: 1 } });
  return mapConfig(row);
}

/**
 * Activa Caja de forma idempotente.
 * - Si ya activa: no reinicia activadaEn; no re-inicializa comisiones.
 * - Si no: asegura 20 % solo en vendedores sin comisión; marca activa + timestamp.
 * No genera obligaciones ni toca créditos.
 */
export async function activarCaja(
  db: CajaConfigDb,
  args: { actorAdminId: string; ahora?: Date },
): Promise<ActivarCajaResult> {
  const actorAdminId = args.actorAdminId.trim();
  if (!actorAdminId) {
    throw new CajaValidationError("actorAdminId requerido.");
  }
  const ahora = args.ahora ?? new Date();

  return db.$transaction(async (tx) => {
    const admin = await tx.usuario.findUnique({
      where: { id: actorAdminId },
      select: { id: true, rol: true, activo: true },
    });
    if (!admin || !admin.activo || admin.rol !== "ADMIN") {
      throw new CajaForbiddenError(
        "Solo un administrador activo puede activar Caja.",
        "CAJA_SOLO_ADMIN",
      );
    }

    let config = await tx.cajaConfig.findUnique({ where: { id: 1 } });
    if (!config) {
      config = await tx.cajaConfig.create({
        data: {
          id: 1,
          activa: false,
          activadaEn: null,
          activadaPorAdminId: null,
          updatedAt: ahora,
        },
      });
    }

    if (config.activa && config.activadaEn != null) {
      return {
        config: mapConfig(config),
        alreadyActive: true,
        comisionesInicializadas: 0,
      };
    }

    const vendedores = await tx.usuario.findMany({
      where: { rol: "VENDEDOR" },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    let inicializadas = 0;
    for (const v of vendedores) {
      const r = await ensureComisionInicialSiAusente(tx, {
        vendedorId: v.id,
        actorAdminId,
        ahora,
        motivo: "Alta inicial al activar Caja (20 %)",
      });
      if (r.created) inicializadas += 1;
    }

    const updated = await tx.cajaConfig.update({
      where: { id: 1 },
      data: {
        activa: true,
        activadaEn: ahora,
        activadaPorAdminId: actorAdminId,
        updatedAt: ahora,
      },
    });

    await recordAuditEvent(tx, {
      usuarioId: actorAdminId,
      accion: "ACTIVAR_CAJA",
      entidad: "CAJA_CONFIG",
      entidadId: "1",
      detalle: {
        activadaEn: ahora.toISOString(),
        comisionesInicializadas: inicializadas,
        vendedoresTotales: vendedores.length,
      },
    });

    return {
      config: mapConfig(updated),
      alreadyActive: false,
      comisionesInicializadas: inicializadas,
    };
  });
}
