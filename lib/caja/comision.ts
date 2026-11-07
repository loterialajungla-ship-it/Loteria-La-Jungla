/**
 * Comisión vigente e historial inmutable de Caja.
 *
 * Concurrencia (orden de locks determinista, compatible con createTicket):
 *   1) Usuario(vendedor) FOR UPDATE
 *   2) VendedorComision(vendedor) FOR UPDATE
 *   3) (en createTicket) VendedorCreditoCuenta(actor) FOR UPDATE
 *
 * setComision y la lectura de snapshot de obligación comparten 1→2 sobre el
 * mismo vendedor → se serializan. Vendedores distintos no se bloquean entre sí.
 * No se bloquea Usuario(admin) con FOR UPDATE (evita ciclos con otras ops ADMIN).
 */
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  CajaForbiddenError,
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import {
  COMISION_PORCENTAJE_DEFAULT,
  moneyFixed2,
  parsePorcentajeComision,
} from "@/lib/caja/money";
import type {
  VendedorComisionHistorialView,
  VendedorComisionView,
} from "@/lib/caja/types";

export type ComisionDb = Pick<
  PrismaClient,
  | "vendedorComision"
  | "vendedorComisionHistorial"
  | "usuario"
  | "cajaConfig"
  | "auditoria"
  | "$transaction"
>;

/** Cliente de TX o Prisma con los delegates de comisión. */
export type ComisionTx = Pick<
  PrismaClient,
  "vendedorComision" | "vendedorComisionHistorial" | "usuario" | "auditoria"
> &
  Partial<Pick<PrismaClient, "$queryRaw">>;

type ComisionLockTx = ComisionTx &
  Pick<PrismaClient, "$queryRaw">;

function newHistorialId(): string {
  return `vch_${randomBytes(12).toString("hex")}`;
}

function mapComision(row: {
  vendedorId: string;
  porcentaje: Prisma.Decimal;
  updatedAt: Date;
  updatedByAdminId: string | null;
}): VendedorComisionView {
  return {
    vendedorId: row.vendedorId,
    porcentaje: row.porcentaje,
    updatedAt: row.updatedAt,
    updatedByAdminId: row.updatedByAdminId,
  };
}

function mapHistorial(row: {
  id: string;
  vendedorId: string;
  porcentajeAnterior: Prisma.Decimal | null;
  porcentajeNuevo: Prisma.Decimal;
  changedAt: Date;
  changedByAdminId: string | null;
  motivo: string | null;
}): VendedorComisionHistorialView {
  return {
    id: row.id,
    vendedorId: row.vendedorId,
    porcentajeAnterior: row.porcentajeAnterior,
    porcentajeNuevo: row.porcentajeNuevo,
    changedAt: row.changedAt,
    changedByAdminId: row.changedByAdminId,
    motivo: row.motivo,
  };
}

async function assertVendedorActivo(
  db: Pick<PrismaClient, "usuario">,
  vendedorId: string,
): Promise<void> {
  const id = vendedorId.trim();
  if (!id) {
    throw new CajaValidationError("vendedorId requerido.");
  }
  const user = await db.usuario.findUnique({
    where: { id },
    select: { id: true, rol: true },
  });
  if (!user) {
    throw new CajaNotFoundError("Vendedor no encontrado.", "CAJA_VENDEDOR_NO_ENCONTRADO");
  }
  if (user.rol !== "VENDEDOR") {
    throw new CajaValidationError(
      "Solo se pueden gestionar comisiones de usuarios con rol VENDEDOR.",
      "CAJA_NO_ES_VENDEDOR",
    );
  }
}

type UsuarioLockRow = { id: string; rol: string; activo: boolean };

/**
 * Bloquea Usuario(vendedor) FOR UPDATE y exige rol VENDEDOR activo.
 * Primer eslabón del orden de locks de comisión.
 */
export async function lockVendedorUsuarioForUpdate(
  tx: Pick<PrismaClient, "$queryRaw">,
  vendedorId: string,
): Promise<UsuarioLockRow> {
  const id = vendedorId.trim();
  if (!id) {
    throw new CajaValidationError("vendedorId requerido.");
  }
  const rows = await tx.$queryRaw<UsuarioLockRow[]>`
    SELECT id, rol, activo
    FROM "Usuario"
    WHERE id = ${id}
    FOR UPDATE
  `;
  const user = rows[0];
  if (!user) {
    throw new CajaNotFoundError(
      "Vendedor no encontrado.",
      "CAJA_VENDEDOR_NO_ENCONTRADO",
    );
  }
  if (user.rol !== "VENDEDOR") {
    throw new CajaValidationError(
      "Solo se pueden gestionar comisiones de usuarios con rol VENDEDOR.",
      "CAJA_NO_ES_VENDEDOR",
    );
  }
  if (!user.activo) {
    throw new CajaValidationError(
      "El vendedor está inactivo.",
      "CAJA_VENDEDOR_INACTIVO",
    );
  }
  return user;
}

type ComisionLockRow = {
  vendedorId: string;
  porcentaje: Prisma.Decimal;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

/**
 * SELECT … FOR UPDATE de VendedorComision (segundo eslabón del orden).
 * No crea fila si falta — eso lo hace ensure/set.
 */
export async function lockVendedorComisionForUpdate(
  tx: Pick<PrismaClient, "$queryRaw">,
  vendedorId: string,
): Promise<ComisionLockRow | null> {
  const id = vendedorId.trim();
  if (!id) {
    throw new CajaValidationError("vendedorId requerido.");
  }
  const rows = await tx.$queryRaw<ComisionLockRow[]>`
    SELECT "vendedorId", "porcentaje", "updatedAt", "updatedByAdminId"
    FROM "VendedorComision"
    WHERE "vendedorId" = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function esConflictoUnicoComision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
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
      "Solo un administrador activo puede gestionar comisiones.",
      "CAJA_SOLO_ADMIN",
    );
  }
  return admin.id;
}

export async function getComisionVigente(
  db: Pick<PrismaClient, "vendedorComision">,
  vendedorId: string,
): Promise<VendedorComisionView | null> {
  const id = vendedorId.trim();
  if (!id) return null;
  const row = await db.vendedorComision.findUnique({ where: { vendedorId: id } });
  return row ? mapComision(row) : null;
}

export async function listComisionHistorial(
  db: Pick<PrismaClient, "vendedorComisionHistorial">,
  vendedorId: string,
): Promise<VendedorComisionHistorialView[]> {
  const id = vendedorId.trim();
  if (!id) return [];
  const rows = await db.vendedorComisionHistorial.findMany({
    where: { vendedorId: id },
    orderBy: [{ changedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapHistorial);
}

/**
 * Crea comisión inicial 20 % si no existe. No sobrescribe personalizadas.
 * Pensado para TX de activación o alta de vendedor post-Caja.
 *
 * Si `tx` expone `$queryRaw` y `bloquear=true` (default en emisión de ticket),
 * usa FOR UPDATE sobre VendedorComision para serializar con setComision.
 * Requiere que Usuario(vendedor) ya esté bloqueado o no contendido.
 */
export async function ensureComisionInicialSiAusente(
  tx: ComisionTx,
  args: {
    vendedorId: string;
    actorAdminId: string | null;
    ahora?: Date;
    motivo?: string | null;
    /** Si true, valida rol VENDEDOR (default true). */
    validarVendedor?: boolean;
    /**
     * Si true y hay `$queryRaw`, SELECT FOR UPDATE de la comisión.
     * Default: true cuando `$queryRaw` está disponible.
     */
    bloquear?: boolean;
  },
): Promise<{ comision: VendedorComisionView; created: boolean }> {
  const vendedorId = args.vendedorId.trim();
  if (!vendedorId) {
    throw new CajaValidationError("vendedorId requerido.");
  }
  if (args.validarVendedor !== false) {
    await assertVendedorActivo(tx, vendedorId);
  }

  const canLock =
    args.bloquear !== false && typeof tx.$queryRaw === "function";

  if (canLock) {
    const locked = await lockVendedorComisionForUpdate(
      tx as ComisionLockTx,
      vendedorId,
    );
    if (locked) {
      return { comision: mapComision(locked), created: false };
    }
  } else {
    const existing = await tx.vendedorComision.findUnique({
      where: { vendedorId },
    });
    if (existing) {
      return { comision: mapComision(existing), created: false };
    }
  }

  const ahora = args.ahora ?? new Date();
  const pct = COMISION_PORCENTAJE_DEFAULT;
  const actorId = args.actorAdminId?.trim() || null;

  try {
    const created = await tx.vendedorComision.create({
      data: {
        vendedorId,
        porcentaje: pct,
        updatedAt: ahora,
        updatedByAdminId: actorId,
      },
    });

    await tx.vendedorComisionHistorial.create({
      data: {
        id: newHistorialId(),
        vendedorId,
        porcentajeAnterior: null,
        porcentajeNuevo: pct,
        changedAt: ahora,
        changedByAdminId: actorId,
        motivo: args.motivo?.trim() || "Alta inicial de comisión (20 %)",
      },
    });

    if (actorId) {
      await recordAuditEvent(tx, {
        usuarioId: actorId,
        accion: "CREAR_COMISION_VENDEDOR",
        entidad: "VENDEDOR_COMISION",
        entidadId: vendedorId,
        detalle: {
          porcentajeNuevo: moneyFixed2(pct),
          porcentajeAnterior: null,
          motivo: args.motivo?.trim() || "Alta inicial de comisión (20 %)",
        },
      });
    }

    return { comision: mapComision(created), created: true };
  } catch (error) {
    // Carrera de alta inicial: re-leer bajo lock si es posible.
    if (!esConflictoUnicoComision(error)) throw error;
    if (canLock) {
      const again = await lockVendedorComisionForUpdate(
        tx as ComisionLockTx,
        vendedorId,
      );
      if (again) return { comision: mapComision(again), created: false };
    }
    const again = await tx.vendedorComision.findUnique({
      where: { vendedorId },
    });
    if (again) return { comision: mapComision(again), created: false };
    throw error;
  }
}

/**
 * Asigna 20 % a un vendedor recién creado solo si Caja ya está activa.
 * No activa Caja. Idempotente si ya hay comisión.
 */
export async function ensureComisionParaVendedorNuevoSiCajaActiva(
  db: ComisionDb,
  args: {
    vendedorId: string;
    actorAdminId: string | null;
    ahora?: Date;
  },
): Promise<{ comision: VendedorComisionView | null; created: boolean }> {
  const config = await db.cajaConfig.findUnique({ where: { id: 1 } });
  if (!config?.activa) {
    return { comision: null, created: false };
  }

  return db.$transaction(async (tx) => {
    const r = await ensureComisionInicialSiAusente(tx, {
      vendedorId: args.vendedorId,
      actorAdminId: args.actorAdminId,
      ahora: args.ahora,
      motivo: "Alta inicial al crear vendedor (Caja activa, 20 %)",
    });
    return r;
  });
}

/**
 * Cambia la comisión vigente. Misma TX: update + historial + auditoría.
 * Si el % es igual al vigente, no genera historial ni auditoría de cambio.
 */
export async function setComisionVendedor(
  db: ComisionDb,
  args: {
    vendedorId: string;
    porcentaje: Prisma.Decimal | string | number;
    actorAdminId: string;
    motivo?: string | null;
    ahora?: Date;
  },
): Promise<{
  comision: VendedorComisionView;
  changed: boolean;
  historial: VendedorComisionHistorialView | null;
}> {
  const porcentaje = parsePorcentajeComision(args.porcentaje);

  return db.$transaction(
    async (tx) => {
      // Admin solo lectura (sin FOR UPDATE) → no entra en el orden de locks
      // del vendedor / no cicla con createTicket(ADMIN).
      const actorAdminId = await assertAdminActor(tx, args.actorAdminId);
      const vendedorId = args.vendedorId.trim();

      // Orden: Usuario(vendedor) → VendedorComision(vendedor).
      await lockVendedorUsuarioForUpdate(tx, vendedorId);
      const existing = await lockVendedorComisionForUpdate(tx, vendedorId);

      // Timestamp tras el lock: refleja orden real de commit bajo concurrencia
      // (no el instante de encolado antes de esperar el FOR UPDATE).
      const ahora = args.ahora ?? new Date();

      if (!existing) {
        const created = await tx.vendedorComision.create({
          data: {
            vendedorId,
            porcentaje,
            updatedAt: ahora,
            updatedByAdminId: actorAdminId,
          },
        });
        const hist = await tx.vendedorComisionHistorial.create({
          data: {
            id: newHistorialId(),
            vendedorId,
            porcentajeAnterior: null,
            porcentajeNuevo: porcentaje,
            changedAt: ahora,
            changedByAdminId: actorAdminId,
            motivo: args.motivo?.trim() || "Alta de comisión por administrador",
          },
        });
        await recordAuditEvent(tx, {
          usuarioId: actorAdminId,
          accion: "CREAR_COMISION_VENDEDOR",
          entidad: "VENDEDOR_COMISION",
          entidadId: vendedorId,
          detalle: {
            porcentajeNuevo: moneyFixed2(porcentaje),
            porcentajeAnterior: null,
            motivo: args.motivo?.trim() || null,
          },
        });
        return {
          comision: mapComision(created),
          changed: true,
          historial: mapHistorial(hist),
        };
      }

      if (existing.porcentaje.eq(porcentaje)) {
        return {
          comision: mapComision(existing),
          changed: false,
          historial: null,
        };
      }

      const updated = await tx.vendedorComision.update({
        where: { vendedorId },
        data: {
          porcentaje,
          updatedAt: ahora,
          updatedByAdminId: actorAdminId,
        },
      });

      const hist = await tx.vendedorComisionHistorial.create({
        data: {
          id: newHistorialId(),
          vendedorId,
          porcentajeAnterior: existing.porcentaje,
          porcentajeNuevo: porcentaje,
          changedAt: ahora,
          changedByAdminId: actorAdminId,
          motivo: args.motivo?.trim() || null,
        },
      });

      await recordAuditEvent(tx, {
        usuarioId: actorAdminId,
        accion: "CAMBIAR_COMISION_VENDEDOR",
        entidad: "VENDEDOR_COMISION",
        entidadId: vendedorId,
        detalle: {
          porcentajeAnterior: moneyFixed2(existing.porcentaje),
          porcentajeNuevo: moneyFixed2(porcentaje),
          motivo: args.motivo?.trim() || null,
        },
      });

      return {
        comision: mapComision(updated),
        changed: true,
        historial: mapHistorial(hist),
      };
    },
    {
      maxWait: 30_000,
      timeout: 60_000,
    },
  );
}
