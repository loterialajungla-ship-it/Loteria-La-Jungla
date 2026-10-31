/**
 * Snapshot / restore de CreditosConfig (singleton id=1) para suites TEST.
 *
 * - Lee el estado real (o ausencia de fila).
 * - No asume controlActivo=false ni inicioEn=null.
 * - Restaura exactamente el snapshot (recrea, actualiza o elimina si no existía)
 *   **solo si** el estado actual sigue siendo el override de ese lease (propiedad
 *   de la ejecución). Si otro proceso cambió la fila, se omite el restore.
 *
 * Limitación — terminación abrupta (kill -9, crash, SIGKILL):
 *   No hay recovery automática de snapshots antiguos. Un proceso muerto puede
 *   dejar controlActivo=false temporal. La siguiente suite hace su propio
 *   snapshot al arrancar y restaura el suyo al terminar; **no** se reaplican
 *   snapshots de ejecuciones anteriores (evitaría pisar cambios ajenos).
 * - Pensado para un solo proceso de suite (runner 1 archivo); no es un lock
 *   distribuido entre procesos.
 */
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertIntegrationPrismaClient } from "@/lib/tickets/integration/harness";

export type CreditosConfigSnapshot =
  | { existed: false }
  | {
      existed: true;
      controlActivo: boolean;
      inicioEn: Date | null;
      umbralSaldoBajo: Prisma.Decimal | null;
      updatedByAdminId: string | null;
    };

export type CreditosConfigPatch = {
  controlActivo?: boolean;
  inicioEn?: Date | null;
  umbralSaldoBajo?: Prisma.Decimal | null;
  updatedByAdminId?: string | null;
};

/**
 * Lease de un override temporal: guarda el snap original + la marca esperada
 * mientras el hold está activo. `restoreCreditosConfigLease` solo escribe si
 * el estado actual aún coincide con esa marca (no pisa cambios ajenos).
 */
export type CreditosConfigHeldMarker = {
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo: Prisma.Decimal | null;
  updatedByAdminId: string | null;
};

export type CreditosConfigLease = {
  leaseId: string;
  snap: CreditosConfigSnapshot;
  /** Estado que nosotros dejamos tras el override. */
  held: CreditosConfigHeldMarker;
};

export type CreditosConfigRestoreResult =
  | "restored"
  | "already_at_snap"
  | "skipped_foreign_change";

function umbralKey(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "null";
  return v.toFixed(2);
}

function inicioKey(v: Date | null | undefined): string {
  if (v == null) return "null";
  return v.toISOString();
}

function snapshotsEqual(
  a: CreditosConfigSnapshot,
  b: CreditosConfigSnapshot,
): boolean {
  if (!a.existed && !b.existed) return true;
  if (!a.existed || !b.existed) return false;
  return (
    a.controlActivo === b.controlActivo &&
    inicioKey(a.inicioEn) === inicioKey(b.inicioEn) &&
    umbralKey(a.umbralSaldoBajo) === umbralKey(b.umbralSaldoBajo) &&
    a.updatedByAdminId === b.updatedByAdminId
  );
}

function currentMatchesHeld(
  current: CreditosConfigSnapshot,
  held: CreditosConfigHeldMarker,
): boolean {
  if (!current.existed) return false;
  return (
    current.controlActivo === held.controlActivo &&
    inicioKey(current.inicioEn) === inicioKey(held.inicioEn) &&
    umbralKey(current.umbralSaldoBajo) === umbralKey(held.umbralSaldoBajo) &&
    current.updatedByAdminId === held.updatedByAdminId
  );
}

export async function readCreditosConfigSnapshot(
  db: PrismaClient,
): Promise<CreditosConfigSnapshot> {
  assertIntegrationPrismaClient(db);
  const row = await db.creditosConfig.findUnique({ where: { id: 1 } });
  if (!row) return { existed: false };
  return {
    existed: true,
    controlActivo: row.controlActivo,
    inicioEn: row.inicioEn,
    umbralSaldoBajo: row.umbralSaldoBajo,
    updatedByAdminId: row.updatedByAdminId,
  };
}

/**
 * Restore incondicional del snapshot. Preferir `restoreCreditosConfigLease`
 * en hooks de test: este helper no comprueba propiedad del estado actual.
 */
export async function restoreCreditosConfigSnapshot(
  db: PrismaClient,
  snap: CreditosConfigSnapshot,
): Promise<void> {
  assertIntegrationPrismaClient(db);
  if (!snap.existed) {
    await db.creditosConfig.deleteMany({ where: { id: 1 } });
    return;
  }
  await db.creditosConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      controlActivo: snap.controlActivo,
      inicioEn: snap.inicioEn,
      umbralSaldoBajo: snap.umbralSaldoBajo,
      updatedByAdminId: snap.updatedByAdminId,
    },
    update: {
      controlActivo: snap.controlActivo,
      inicioEn: snap.inicioEn,
      umbralSaldoBajo: snap.umbralSaldoBajo,
      updatedByAdminId: snap.updatedByAdminId,
    },
  });
}

/**
 * Tras una mutación intencional de CreditosConfig en el mismo proceso/test,
 * actualiza la marca `held` del lease para que `restoreCreditosConfigLease`
 * siga reconociendo el estado como propio.
 */
export async function acknowledgeCreditosConfigLeaseHeld(
  db: PrismaClient,
  lease: CreditosConfigLease,
): Promise<void> {
  assertIntegrationPrismaClient(db);
  const current = await readCreditosConfigSnapshot(db);
  if (!current.existed) {
    throw new Error(
      `[creditos-config-fixture] acknowledge lease=${lease.leaseId}: ` +
        `se esperaba fila id=1 tras mutación propia`,
    );
  }
  lease.held = {
    controlActivo: current.controlActivo,
    inicioEn: current.inicioEn,
    umbralSaldoBajo: current.umbralSaldoBajo,
    updatedByAdminId: current.updatedByAdminId,
  };
}

/**
 * Restaura el snap del lease solo si el estado actual sigue siendo el de este
 * lease (override inicial o mutación propia reconocida vía
 * `acknowledgeCreditosConfigLeaseHeld`), o ya coincide con el snap.
 * Si otro proceso mutó la fila, no escribe y emite warning.
 */
export async function restoreCreditosConfigLease(
  db: PrismaClient,
  lease: CreditosConfigLease,
): Promise<CreditosConfigRestoreResult> {
  assertIntegrationPrismaClient(db);
  const current = await readCreditosConfigSnapshot(db);
  if (snapshotsEqual(current, lease.snap)) {
    return "already_at_snap";
  }
  if (!currentMatchesHeld(current, lease.held)) {
    console.warn(
      `[creditos-config-fixture] SKIP restore lease=${lease.leaseId}: ` +
        `estado actual no coincide con el override de este lease ` +
        `(posible cambio ajeno o terminación a medias). No se pisa.`,
    );
    return "skipped_foreign_change";
  }
  await restoreCreditosConfigSnapshot(db, lease.snap);
  return "restored";
}

/**
 * Override temporal control OFF para suites de venta sin consumo.
 * Devuelve un lease; restaurar con `restoreCreditosConfigLease`.
 * No asume que el estado previo fuera OFF; no toca umbral/updatedBy en update
 * (en create usa nulls).
 */
export async function beginTemporaryCreditosControlOff(
  db: PrismaClient,
): Promise<CreditosConfigLease> {
  assertIntegrationPrismaClient(db);
  const before = await readCreditosConfigSnapshot(db);
  const heldUmbral = before.existed ? before.umbralSaldoBajo : null;
  const heldUpdatedBy = before.existed ? before.updatedByAdminId : null;
  await db.creditosConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: null,
      updatedByAdminId: null,
    },
    update: {
      controlActivo: false,
      inicioEn: null,
    },
  });
  return {
    leaseId: randomBytes(6).toString("hex"),
    snap: before,
    held: {
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: heldUmbral,
      updatedByAdminId: heldUpdatedBy,
    } satisfies CreditosConfigHeldMarker,
  };
}

/**
 * Restaura un baseline de suite (snapshot leído al `before`) solo si el
 * estado actual aún parece el override OFF típico de los tests, o ya es el
 * snap. No reescribe cambios ajenos.
 */
export async function restoreCreditosConfigBaseline(
  db: PrismaClient,
  snap: CreditosConfigSnapshot,
): Promise<CreditosConfigRestoreResult> {
  return restoreCreditosConfigLease(db, {
    leaseId: "suite-baseline",
    snap,
    held: {
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: snap.existed ? snap.umbralSaldoBajo : null,
      updatedByAdminId: snap.existed ? snap.updatedByAdminId : null,
    },
  });
}

/**
 * Aplica un override temporal y restaura el estado previo en `finally`
 * solo si el hold sigue siendo propiedad de este lease.
 */
export async function withCreditosConfigOverride<T>(
  db: PrismaClient,
  patch: CreditosConfigPatch,
  fn: () => Promise<T>,
): Promise<T> {
  assertIntegrationPrismaClient(db);
  const before = await readCreditosConfigSnapshot(db);
  const base = before.existed
    ? {
        controlActivo: before.controlActivo,
        inicioEn: before.inicioEn,
        umbralSaldoBajo: before.umbralSaldoBajo,
        updatedByAdminId: before.updatedByAdminId,
      }
    : {
        controlActivo: false,
        inicioEn: null as Date | null,
        umbralSaldoBajo: null as Prisma.Decimal | null,
        updatedByAdminId: null as string | null,
      };
  const next = { ...base, ...patch };
  await db.creditosConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...next },
    update: next,
  });
  const lease: CreditosConfigLease = {
    leaseId: randomBytes(6).toString("hex"),
    snap: before,
    held: {
      controlActivo: next.controlActivo,
      inicioEn: next.inicioEn,
      umbralSaldoBajo: next.umbralSaldoBajo,
      updatedByAdminId: next.updatedByAdminId,
    },
  };
  try {
    return await fn();
  } finally {
    await restoreCreditosConfigLease(db, lease);
  }
}
