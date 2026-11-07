/**
 * Lógica de activación operativa de Caja en producción (C7.2).
 * Invocada solo por scripts/activate-caja-production.ts tras guards dual-opt-in.
 * No se ejecuta en arranque de app ni en migraciones.
 */
import type { PrismaClient } from "@prisma/client";
import { activarCaja, getCajaConfig } from "@/lib/caja/config";
import {
  COMISION_PORCENTAJE_DEFAULT,
  moneyFixed2,
} from "@/lib/caja/money";

export class ActivateCajaProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivateCajaProductionError";
  }
}

export type ActivateCajaProductionResult = {
  alreadyActive: boolean;
  activa: boolean;
  activadaEnIso: string | null;
  activadaPorAdminId: string | null;
  comisionesInicializadas: number;
  vendedoresConComision: number;
  vendedoresSinComision: number;
  comisionDefault: string;
};

/**
 * Resuelve el ADMIN actor: ACTIVATE_CAJA_ADMIN_USER_ID o único ADMIN activo.
 */
export async function resolveActivateCajaAdminId(
  db: Pick<PrismaClient, "usuario">,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<string> {
  const explicit = env.ACTIVATE_CAJA_ADMIN_USER_ID?.trim() ?? "";
  if (explicit) {
    const admin = await db.usuario.findUnique({
      where: { id: explicit },
      select: { id: true, rol: true, activo: true },
    });
    if (!admin || admin.rol !== "ADMIN" || !admin.activo) {
      throw new ActivateCajaProductionError(
        "ACTIVATE_CAJA_ADMIN_USER_ID no es un ADMIN activo.",
      );
    }
    return admin.id;
  }

  const admins = await db.usuario.findMany({
    where: { rol: "ADMIN", activo: true },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (admins.length === 0) {
    throw new ActivateCajaProductionError(
      "No hay ADMIN activo para activar Caja. Define ACTIVATE_CAJA_ADMIN_USER_ID.",
    );
  }
  if (admins.length > 1) {
    throw new ActivateCajaProductionError(
      "Hay varios ADMIN activos: define ACTIVATE_CAJA_ADMIN_USER_ID explícitamente.",
    );
  }
  return admins[0]!.id;
}

/**
 * Comprueba que el esquema Caja esté disponible (migraciones aplicadas).
 */
export async function assertCajaSchemaReady(
  db: Pick<PrismaClient, "cajaConfig">,
): Promise<void> {
  try {
    await db.cajaConfig.findUnique({ where: { id: 1 } });
  } catch {
    throw new ActivateCajaProductionError(
      "Esquema Caja no disponible. Aplique las migraciones Caja antes de activar.",
    );
  }
}

export async function runActivateCajaProduction(
  db: PrismaClient,
  args: { actorAdminId: string },
): Promise<ActivateCajaProductionResult> {
  await assertCajaSchemaReady(db);

  const before = await getCajaConfig(db);
  const result = await activarCaja(db, { actorAdminId: args.actorAdminId });
  const after = await getCajaConfig(db);

  if (!after.activa || after.activadaEn == null) {
    throw new ActivateCajaProductionError(
      "activarCaja no dejó Caja activa con activadaEn. Abortado.",
    );
  }

  const vendedores = await db.usuario.findMany({
    where: { rol: "VENDEDOR" },
    select: { id: true },
  });
  const comisiones = await db.vendedorComision.findMany({
    select: { vendedorId: true },
  });
  const conComision = new Set(comisiones.map((c) => c.vendedorId));
  let sin = 0;
  for (const v of vendedores) {
    if (!conComision.has(v.id)) sin += 1;
  }

  // Idempotencia: si ya estaba activa, activadaEn no debe cambiar.
  if (
    before.activa &&
    before.activadaEn &&
    after.activadaEn.getTime() !== before.activadaEn.getTime()
  ) {
    throw new ActivateCajaProductionError(
      "Inconsistencia: activadaEn cambió en re-activación idempotente.",
    );
  }

  return {
    alreadyActive: result.alreadyActive,
    activa: after.activa,
    activadaEnIso: after.activadaEn.toISOString(),
    activadaPorAdminId: after.activadaPorAdminId,
    comisionesInicializadas: result.comisionesInicializadas,
    vendedoresConComision: conComision.size,
    vendedoresSinComision: sin,
    comisionDefault: moneyFixed2(COMISION_PORCENTAJE_DEFAULT),
  };
}
