/**
 * Harness Fase 5 — créditos en TEST con limpieza acotada.
 *
 * - Sin resetTicketDomain / deleteMany globales.
 * - Solo borra usuarios/tickets/movimientos/sesiones creados por esta corrida
 *   (prefijo `fase5_qa_`).
 * - Snapshot + restore de CreditosConfig.
 * - No toca Auditoria (FK Restrict / propiedad ambigua).
 */
import { Prisma } from "@prisma/client";
import { createSession } from "@/lib/auth/session";
import { actualizarCreditosConfig, getCreditosConfig } from "@/lib/creditos/config";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import {
  createIntegrationPrismaClient,
  createTestUser,
  type IntegrationPrismaClient,
} from "@/lib/tickets/integration/harness";

export const FASE5_USER_PREFIX = "fase5_qa_";
export const ANIMAL_A = "03";
export const ANIMAL_B = "05";
export const FASE5_PASSWORD = "testpass12";

export type ConfigSnapshot = {
  existed: boolean;
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo: Prisma.Decimal | null;
};

export type Fase5Registry = {
  runId: string;
  userIds: Set<string>;
  sessionIds: Set<string>;
  ticketIds: Set<string>;
  movimientoIds: Set<string>;
  configSnapshot: ConfigSnapshot | null;
  cleanupAllowed: boolean;
};

export type Fase5Context = {
  db: IntegrationPrismaClient;
  registry: Fase5Registry;
  credits: ReturnType<typeof createPrismaCreditosStore>;
  trackUser: (id: string) => void;
  trackSession: (id: string) => void;
  trackTicket: (id: string) => void;
  trackMovimiento: (id: string) => void;
  createUser: (args: {
    suffix: string;
    nombre: string;
    rol: "ADMIN" | "VENDEDOR";
  }) => Promise<{ id: string; usuario: string; rol: "ADMIN" | "VENDEDOR" }>;
  openSession: (usuarioId: string) => Promise<{ token: string; sessionId: string }>;
  snapshotConfig: () => Promise<ConfigSnapshot>;
  restoreConfig: (actorAdminId: string) => Promise<void>;
  cleanupOwn: () => Promise<{
    cleaned: boolean;
    deletedTickets: number;
    deletedMovimientos: number;
    deletedCuentas: number;
    deletedSessions: number;
    deletedUsers: number;
    retainedUsers: string[];
    configRestored: boolean;
  }>;
};

function emptyRegistry(runId: string): Fase5Registry {
  return {
    runId,
    userIds: new Set(),
    sessionIds: new Set(),
    ticketIds: new Set(),
    movimientoIds: new Set(),
    configSnapshot: null,
    cleanupAllowed: false,
  };
}

export async function bootstrapFase5(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<Fase5Context> {
  assertIntegrationPointsAtTestDatabase(env);
  const db = createIntegrationPrismaClient(env);
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const registry = emptyRegistry(runId);
  const credits = createPrismaCreditosStore(db);

  const animals = await db.animal.count({
    where: { numero: { in: [ANIMAL_A, ANIMAL_B] } },
  });
  if (animals < 2) {
    await db.$disconnect();
    throw new Error(
      "Fase5 BLOCKED: faltan animales 03/05 en TEST (no se inventan ni mutan aquí).",
    );
  }
  const mult = await db.configNegocio.findUnique({
    where: { clave: "MULTIPLICADOR_PREMIO" },
  });
  if (!mult) {
    await db.$disconnect();
    throw new Error(
      "Fase5 BLOCKED: falta ConfigNegocio MULTIPLICADOR_PREMIO en TEST.",
    );
  }

  const schema = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'CreditosConfig'
    ) AS "exists"
  `;
  if (!schema[0]?.exists) {
    await db.$disconnect();
    throw new Error("Fase5 BLOCKED: schema de créditos ausente en TEST.");
  }

  registry.cleanupAllowed = true;

  async function snapshotConfig(): Promise<ConfigSnapshot> {
    const row = await db.creditosConfig.findFirst();
    const snap: ConfigSnapshot = row
      ? {
          existed: true,
          controlActivo: row.controlActivo,
          inicioEn: row.inicioEn,
          umbralSaldoBajo: row.umbralSaldoBajo,
        }
      : {
          existed: false,
          controlActivo: false,
          inicioEn: null,
          umbralSaldoBajo: null,
        };
    registry.configSnapshot = snap;
    return snap;
  }

  async function restoreConfig(actorAdminId: string): Promise<void> {
    const snap = registry.configSnapshot;
    if (!snap) return;
    // Siempre restaura valores previos (existiera o no la fila: defaults dominio).
    await actualizarCreditosConfig(credits, {
      controlActivo: snap.controlActivo,
      inicioEn: snap.inicioEn,
      umbralSaldoBajo: snap.umbralSaldoBajo,
      updatedByAdminId: actorAdminId,
    });
  }

  return {
    db,
    registry,
    credits,
    trackUser: (id) => registry.userIds.add(id),
    trackSession: (id) => registry.sessionIds.add(id),
    trackTicket: (id) => registry.ticketIds.add(id),
    trackMovimiento: (id) => registry.movimientoIds.add(id),
    async createUser(args) {
      const usuario = `${FASE5_USER_PREFIX}${registry.runId}_${args.suffix}`.slice(
        0,
        40,
      );
      const user = await createTestUser(db, {
        usuario,
        nombre: args.nombre,
        rol: args.rol,
        password: FASE5_PASSWORD,
      });
      registry.userIds.add(user.id);
      return user;
    },
    async openSession(usuarioId) {
      const s = await createSession(db, usuarioId);
      registry.sessionIds.add(s.sessionId);
      return { token: s.token, sessionId: s.sessionId };
    },
    snapshotConfig,
    restoreConfig,
    async cleanupOwn() {
      if (!registry.cleanupAllowed) {
        return {
          cleaned: false,
          deletedTickets: 0,
          deletedMovimientos: 0,
          deletedCuentas: 0,
          deletedSessions: 0,
          deletedUsers: 0,
          retainedUsers: [...registry.userIds],
          configRestored: false,
        };
      }

      const userIds = [...registry.userIds];
      let deletedTickets = 0;
      let deletedMovimientos = 0;
      let deletedCuentas = 0;
      let deletedSessions = 0;
      let deletedUsers = 0;
      const retainedUsers: string[] = [];

      // 1) Restaurar config ANTES de borrar admins propios.
      let configRestored = false;
      if (registry.configSnapshot) {
        try {
          const admin = await db.usuario.findFirst({
            where: { id: { in: userIds }, rol: "ADMIN" },
            select: { id: true },
          });
          if (admin) {
            await restoreConfig(admin.id);
            configRestored = true;
          } else {
            const snap = registry.configSnapshot;
            if (snap.existed) {
              await db.creditosConfig.updateMany({
                data: {
                  controlActivo: snap.controlActivo,
                  inicioEn: snap.inicioEn,
                  umbralSaldoBajo: snap.umbralSaldoBajo,
                },
              });
              configRestored = true;
            } else {
              // Solo si no había fila al inicio: no tocar filas ajenas.
              const count = await db.creditosConfig.count();
              if (count === 0) configRestored = true;
            }
          }
        } catch {
          configRestored = false;
        }
      }

      // 2) Movimientos/cuentas solo de vendedores de esta corrida.
      if (userIds.length > 0) {
        const movDel = await db.creditoMovimiento.deleteMany({
          where: { vendedorId: { in: userIds } },
        });
        deletedMovimientos = movDel.count;

        const cueDel = await db.vendedorCreditoCuenta.deleteMany({
          where: { vendedorId: { in: userIds } },
        });
        deletedCuentas = cueDel.count;
      }

      // 3) Tickets propios
      const ticketIds = [...registry.ticketIds];
      if (ticketIds.length > 0 || userIds.length > 0) {
        const ownTickets = await db.ticket.findMany({
          where: {
            OR: [
              ...(ticketIds.length ? [{ id: { in: ticketIds } }] : []),
              ...(userIds.length ? [{ vendedorId: { in: userIds } }] : []),
            ],
          },
          select: { id: true },
        });
        const ids = ownTickets.map((t) => t.id);
        if (ids.length > 0) {
          await db.ticketLinea.deleteMany({ where: { ticketId: { in: ids } } });
          const tdel = await db.ticket.deleteMany({ where: { id: { in: ids } } });
          deletedTickets = tdel.count;
        }
      }

      if (registry.sessionIds.size > 0) {
        const sdel = await db.usuarioSesion.deleteMany({
          where: { id: { in: [...registry.sessionIds] } },
        });
        deletedSessions = sdel.count;
      }
      if (userIds.length > 0) {
        await db.usuarioSesion.deleteMany({
          where: { usuarioId: { in: userIds } },
        });
      }

      for (const uid of userIds) {
        const audits = await db.auditoria.count({ where: { usuarioId: uid } });
        if (audits > 0) {
          retainedUsers.push(uid);
          continue;
        }
        try {
          await db.usuario.delete({ where: { id: uid } });
          deletedUsers += 1;
        } catch {
          retainedUsers.push(uid);
        }
      }

      registry.cleanupAllowed = false;
      return {
        cleaned: true,
        deletedTickets,
        deletedMovimientos,
        deletedCuentas,
        deletedSessions,
        deletedUsers,
        retainedUsers,
        configRestored,
      };
    },
  };
}

export async function assertSaldoCoincideLibro(
  saldo: Prisma.Decimal,
  movimientos: Array<{
    tipo: string;
    importe: Prisma.Decimal;
    saldoAnterior: Prisma.Decimal;
    saldoPosterior: Prisma.Decimal;
  }>,
): Promise<void> {
  let neto = new Prisma.Decimal(0);
  for (const m of movimientos) {
    let delta: Prisma.Decimal;
    if (m.tipo === "CORRECCION") {
      delta = m.saldoPosterior.minus(m.saldoAnterior);
    } else if (m.tipo === "CONSUMO_VENTA" || m.tipo === "RETIRO") {
      delta = m.importe.negated();
    } else {
      delta = m.importe;
    }
    if (m.saldoPosterior.toFixed(2) !== m.saldoAnterior.plus(delta).toFixed(2)) {
      throw new Error(`movimiento ${m.tipo} incoherente`);
    }
    neto = neto.plus(delta);
  }
  if (saldo.toFixed(2) !== neto.toFixed(2)) {
    throw new Error(
      `saldo ${saldo.toFixed(2)} ≠ neto libro ${neto.toFixed(2)}`,
    );
  }
}

export async function readConfigPublic(ctx: Fase5Context) {
  return getCreditosConfig(ctx.credits);
}
