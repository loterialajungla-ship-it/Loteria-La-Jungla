/**
 * Harness de integración aislada para programación de resultados (Fase 3A).
 *
 * - Solo TEST vía createIntegrationPrismaClient / assertIntegrationWriteTarget.
 * - Sin resetTicketDomain, sin deleteMany globales, sin seeds, sin mutar Animal.
 * - Limpieza de negocio exclusivamente por IDs de Resultado/ResultadoProgramado
 *   registrados desde el retorno de create/dominio (propiedad inequívoca).
 * - Auditorías: NUNCA se capturan para cleanup ni se borran. `recordAuditEvent`
 *   no devuelve id; un diferencial por entidadId podría atribuir filas ajenas.
 *   La verificación de auditoría es solo lectura (existencia esperada).
 * - Usuarios de prueba: se intentan borrar solo si no tienen filas Auditoria
 *   con ese usuarioId (FK Restrict). Si las hay, se conservan y se documenta.
 */
import type { AccionAuditoria, EntidadAuditoria, PrismaClient } from "@prisma/client";
import { assertCanonicalAnimalCatalogFromDb } from "@/lib/resultados/catalogo-animalitos-canonico";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import {
  createIntegrationPrismaClient,
  createTestUser,
  type IntegrationPrismaClient,
} from "@/lib/tickets/integration/harness";

/** Fecha reservada de la suite — no implica propiedad; solo namespace + preflight. */
export const FECHA_SUITE = new Date(Date.UTC(2099, 10, 17));

/**
 * Segunda fecha reservada (caso F / rollback). Las horas 9–19 de FECHA_SUITE
 * ya están ocupadas por A–E/G; F usa esta fecha + hora 9 para no solapar.
 */
export const FECHA_SUITE_ROLLBACK = new Date(Date.UTC(2099, 10, 18));

export type CatalogRow = { numero: string; nombre: string };

/** Superficie mínima que exige `tryCreateAutomaticResult`. */
export type AutoPublishDbLike = Pick<
  PrismaClient,
  "animal" | "resultado" | "resultadoProgramado" | "auditoria" | "$transaction"
>;

/**
 * Wrapper exclusivo de prueba: `$transaction` real de Prisma; dentro de la TX,
 * solo `resultadoProgramado.updateMany` se sustituye para devolver `{ count: 0 }`
 * sin mutar la fila. El resto (p. ej. `resultado.create`, `findUnique`,
 * `auditoria.create`) delega al cliente transaccional real.
 *
 * Fuerza el camino `ProgramacionMaterializacionError` tras el INSERT real,
 * para que Prisma aborte la TX (rollback PostgreSQL del create).
 */
export function wrapDbForceScheduleLinkCountZero(
  db: IntegrationPrismaClient,
): AutoPublishDbLike {
  return {
    animal: db.animal,
    resultado: db.resultado,
    resultadoProgramado: db.resultadoProgramado,
    auditoria: db.auditoria,
    $transaction: ((
      arg: unknown,
      options?: Parameters<PrismaClient["$transaction"]>[1],
    ) => {
      if (typeof arg !== "function") {
        throw new Error(
          "wrapDbForceScheduleLinkCountZero: solo admite $transaction(async tx => …); " +
            "la forma batch/array no está soportada en este wrapper de prueba.",
        );
      }
      const userFn = arg as (
        tx: Record<string, unknown>,
      ) => Promise<unknown>;

      return db.$transaction(async (tx) => {
        const proxiedTx = {
          animal: tx.animal,
          resultado: tx.resultado,
          auditoria: tx.auditoria,
          resultadoProgramado: {
            findUnique: (
              ...args: Parameters<typeof tx.resultadoProgramado.findUnique>
            ) => tx.resultadoProgramado.findUnique(...args),
            findFirst: (
              ...args: Parameters<typeof tx.resultadoProgramado.findFirst>
            ) => tx.resultadoProgramado.findFirst(...args),
            findMany: (
              ...args: Parameters<typeof tx.resultadoProgramado.findMany>
            ) => tx.resultadoProgramado.findMany(...args),
            create: (
              ...args: Parameters<typeof tx.resultadoProgramado.create>
            ) => tx.resultadoProgramado.create(...args),
            update: (
              ...args: Parameters<typeof tx.resultadoProgramado.update>
            ) => tx.resultadoProgramado.update(...args),
            /** Interceptación mínima: no escribe; simula enlace fallido. */
            updateMany: async () => ({ count: 0 }),
            count: (...args: Parameters<typeof tx.resultadoProgramado.count>) =>
              tx.resultadoProgramado.count(...args),
          },
        };
        return userFn(proxiedTx);
      }, options);
    }) as PrismaClient["$transaction"],
  };
}

export type ScheduleIntegrationRegistry = {
  adminUserId: string;
  adminUsuario: string;
  secondaryAdminUserId: string | null;
  secondaryAdminUsuario: string | null;
  programacionIds: Set<string>;
  resultadoIds: Set<string>;
  sesionIds: Set<string>;
  writesStarted: boolean;
  cleanupAllowed: boolean;
  /** Usuarios conservados porque quedan Auditoria con FK Restrict. */
  retainedUserIds: string[];
};

export type CleanupOwnResult = {
  cleaned: boolean;
  reason?: string;
  deletedProgramaciones: number;
  deletedResultados: number;
  deletedUsers: number;
  retainedUsers: string[];
  auditsLeftUntouched: true;
};

export type ScheduleIntegrationContext = {
  db: IntegrationPrismaClient;
  catalog: CatalogRow[];
  registry: ScheduleIntegrationRegistry;
  trackProgramacion: (id: string) => void;
  trackResultado: (id: string) => void;
  trackSesion: (id: string) => void;
  /**
   * Solo lectura: comprueba que existe ≥1 auditoría con entidadId + acción
   * esperados (y opcionalmente entidad). No registra IDs para cleanup.
   * No afirma propiedad exclusiva frente a procesos concurrentes ajenos;
   * solo valida el efecto observable esperado de la operación de la suite.
   */
  assertAuditExists: (args: {
    entidadId: string;
    accion: AccionAuditoria;
    entidad?: EntidadAuditoria;
    minCount?: number;
  }) => Promise<number>;
  cleanupOwn: () => Promise<CleanupOwnResult>;
};

function emptyRegistry(): ScheduleIntegrationRegistry {
  return {
    adminUserId: "",
    adminUsuario: "",
    secondaryAdminUserId: null,
    secondaryAdminUsuario: null,
    programacionIds: new Set(),
    resultadoIds: new Set(),
    sesionIds: new Set(),
    writesStarted: false,
    cleanupAllowed: false,
    retainedUserIds: [],
  };
}

/**
 * Preflight de solo lectura + cliente TEST + usuario exclusivo.
 * Si hay filas en FECHA_SUITE o el catálogo no es canónico → throw sin escrituras.
 *
 * Nota de repetibilidad: el preflight solo cuenta Resultado / ResultadoProgramado
 * en FECHA_SUITE. Auditorías y usuarios residuales `it3a_sched_*` de corridas
 * previas NO bloquean el preflight (entidadId de auditoría no es FK; login es UUID).
 */
export async function bootstrapScheduleIntegration(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<ScheduleIntegrationContext> {
  assertIntegrationPointsAtTestDatabase(env);
  const db = createIntegrationPrismaClient(env);
  const registry = emptyRegistry();

  const [
    resultadoCount,
    programadoCount,
    resultadoRollbackCount,
    programadoRollbackCount,
  ] = await Promise.all([
    db.resultado.count({ where: { fecha: FECHA_SUITE } }),
    db.resultadoProgramado.count({ where: { fecha: FECHA_SUITE } }),
    db.resultado.count({ where: { fecha: FECHA_SUITE_ROLLBACK } }),
    db.resultadoProgramado.count({ where: { fecha: FECHA_SUITE_ROLLBACK } }),
  ]);

  if (
    resultadoCount > 0 ||
    programadoCount > 0 ||
    resultadoRollbackCount > 0 ||
    programadoRollbackCount > 0
  ) {
    await db.$disconnect();
    throw new Error(
      `Preflight schedule-integration: fechas reservadas no vacías ` +
        `(2099-11-17 resultado=${resultadoCount} programado=${programadoCount}; ` +
        `2099-11-18 resultado=${resultadoRollbackCount} programado=${programadoRollbackCount}). ` +
        `Abortado sin escrituras ni cleanup.`,
    );
  }

  let catalog: CatalogRow[];
  try {
    catalog = await assertCanonicalAnimalCatalogFromDb(db);
  } catch (e) {
    await db.$disconnect();
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Preflight schedule-integration: catálogo Animal no canónico (${msg}). ` +
        `Abortado sin escrituras ni cleanup.`,
    );
  }

  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const admin = await createTestUser(db, {
    usuario: `it3a_sched_${runId}`,
    nombre: "IT3A Schedule Admin",
    rol: "ADMIN",
  });

  registry.adminUserId = admin.id;
  registry.adminUsuario = admin.usuario;
  registry.writesStarted = true;
  registry.cleanupAllowed = true;

  const ctx: ScheduleIntegrationContext = {
    db,
    catalog,
    registry,
    trackProgramacion(id: string) {
      if (id) registry.programacionIds.add(id);
    },
    trackResultado(id: string) {
      if (id) registry.resultadoIds.add(id);
    },
    trackSesion(id: string) {
      if (id) registry.sesionIds.add(id);
    },
    async assertAuditExists(args) {
      const entidadId = args.entidadId?.trim();
      if (!entidadId) {
        throw new Error("assertAuditExists: entidadId obligatorio");
      }
      const minCount = args.minCount ?? 1;
      const count = await db.auditoria.count({
        where: {
          entidadId,
          accion: args.accion,
          ...(args.entidad ? { entidad: args.entidad } : {}),
        },
      });
      if (count < minCount) {
        throw new Error(
          `assertAuditExists: esperaba ≥${minCount} auditoría(s) ` +
            `accion=${args.accion} entidadId=${entidadId}; encontrado ${count}`,
        );
      }
      return count;
    },
    async cleanupOwn() {
      if (!registry.cleanupAllowed) {
        return {
          cleaned: false,
          reason: "cleanup no permitido (preflight falló o no hubo bootstrap)",
          deletedProgramaciones: 0,
          deletedResultados: 0,
          deletedUsers: 0,
          retainedUsers: [],
          auditsLeftUntouched: true,
        };
      }
      if (!registry.writesStarted) {
        return {
          cleaned: false,
          reason: "no hubo escrituras registradas",
          deletedProgramaciones: 0,
          deletedResultados: 0,
          deletedUsers: 0,
          retainedUsers: [],
          auditsLeftUntouched: true,
        };
      }

      // Política PROMPT 256: nunca borrar Auditoria (propiedad no demostrable
      // sin id devuelto por recordAuditEvent / correlación inequívoca).

      const progIds = [...registry.programacionIds];
      let deletedProgramaciones = 0;
      if (progIds.length > 0) {
        const r = await db.resultadoProgramado.deleteMany({
          where: { id: { in: progIds } },
        });
        deletedProgramaciones = r.count;
      }

      const resIds = [...registry.resultadoIds];
      let deletedResultados = 0;
      if (resIds.length > 0) {
        const r = await db.resultado.deleteMany({
          where: { id: { in: resIds } },
        });
        deletedResultados = r.count;
      }

      const sesionIds = [...registry.sesionIds];
      if (sesionIds.length > 0) {
        await db.usuarioSesion.deleteMany({
          where: { id: { in: sesionIds } },
        });
      }

      const userIds = [registry.adminUserId, registry.secondaryAdminUserId].filter(
        (id): id is string => Boolean(id),
      );
      let deletedUsers = 0;
      const retainedUsers: string[] = [];

      for (const uid of userIds) {
        await db.usuarioSesion.deleteMany({ where: { usuarioId: uid } });

        // FK Auditoria.usuarioId → Restrict: no borrar auditorías para liberar.
        const auditRefs = await db.auditoria.count({
          where: { usuarioId: uid },
        });
        if (auditRefs > 0) {
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

      registry.retainedUserIds = retainedUsers;
      registry.cleanupAllowed = false;

      return {
        cleaned: true,
        deletedProgramaciones,
        deletedResultados,
        deletedUsers,
        retainedUsers,
        auditsLeftUntouched: true,
        ...(retainedUsers.length > 0
          ? {
              reason:
                "Usuarios de prueba conservados: existen Auditoria con usuarioId " +
                "(FK Restrict). Las auditorías no se borran (propiedad no garantizada).",
            }
          : {}),
      };
    },
  };

  return ctx;
}

/**
 * Crea un segundo ADMIN exclusivo y lo registra para cleanup.
 */
export async function createSecondaryScheduleAdmin(
  ctx: ScheduleIntegrationContext,
): Promise<{ id: string; usuario: string }> {
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const admin = await createTestUser(ctx.db, {
    usuario: `it3a_sched2_${runId}`,
    nombre: "IT3A Schedule Admin 2",
    rol: "ADMIN",
  });
  ctx.registry.secondaryAdminUserId = admin.id;
  ctx.registry.secondaryAdminUsuario = admin.usuario;
  return admin;
}

export async function disconnectScheduleIntegration(
  ctx: ScheduleIntegrationContext | null,
): Promise<void> {
  if (!ctx) return;
  try {
    await ctx.db.$disconnect();
  } catch {
    /* ignore */
  }
}

/** Helpers de invariantes (solo lectura). */
export async function countResultadoSlot(
  db: PrismaClient,
  fecha: Date,
  hora: number,
): Promise<number> {
  return db.resultado.count({ where: { fecha, hora } });
}

export async function countProgramadoSlot(
  db: PrismaClient,
  fecha: Date,
  hora: number,
): Promise<number> {
  return db.resultadoProgramado.count({ where: { fecha, hora } });
}
