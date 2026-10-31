/**
 * Harness de integración aislado para créditos × tickets.
 *
 * - Prefijo/runId únicos; creación de usuarios propios.
 * - Config de control **virtual** en todas las rutas del store (no toca CreditosConfig).
 * - Recuperación acotada por prefijo exacto del run antes del cleanup.
 * - Limpieza solo por IDs verificados; aborta ante ambigüedad.
 * - Prohibido: deleteMany({}), TRUNCATE, DROP, wipe de CreditosConfig.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type EntidadAuditoria } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import type { CreditosConfigView } from "@/lib/creditos/types";
import {
  createPrismaCreditosStore,
  type CreatePrismaCreditosStoreOptions,
} from "@/lib/creditos/prisma-store";
import type { CreditosStore } from "@/lib/creditos/store";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  AHORA_VE_MANANA,
  createIntegrationPrismaClient,
  fechaJuegoDate,
  type IntegrationPrismaClient,
} from "@/lib/tickets/integration/harness";

/**
 * Horas de sorteo que usan las pruebas de créditos×venta con el reloj
 * `AHORA_VE_MANANA` (fecha fixture 2026-10-02). Solo se tocan estos slots.
 */
export const CREDITOS_SALE_FIXTURE_HORAS = [14] as const;

/**
 * Garantiza slots abiertos para la fecha fixture de ventas de integración.
 *
 * No borra Resultado por fecha/hora. Si el slot está ocupado por un resultado
 * preexistente → abort con diagnóstico (no se modifica ni elimina).
 * Esta suite de créditos no crea Resultado; no hay IDs propios que limpiar.
 */
export async function ensureCreditosSaleFixtureSlotsOpen(
  db: IntegrationPrismaClient,
): Promise<{ deletedResultados: number }> {
  const fecha = fechaJuegoDate();
  const horas = [...CREDITOS_SALE_FIXTURE_HORAS];
  const rows = await db.resultado.findMany({
    where: { fecha, hora: { in: horas } },
    select: { id: true, hora: true, origen: true },
  });
  if (rows.length === 0) return { deletedResultados: 0 };
  const detail = rows
    .map((r) => `hora=${r.hora} id=${r.id} origen=${r.origen}`)
    .join("; ");
  throw new Error(
    `[creditos-isolated] ABORT: slot(s) de venta ocupados por Resultado ` +
      `preexistente (fecha fixture ${fechaAYYYYMMDD(fecha)}). ` +
      `No se borran resultados ajenos. Libere el slot en TEST o aísle la fixture. ` +
      detail,
  );
}

export const CREDITOS_QA_PREFIX = "creditos_qa_";
export const CREDITOS_QA_PASSWORD = "testpass12";
export const ANIMAL_A = "03";
export const ANIMAL_B = "05";

/** Tipos de Auditoria.entidad admitidos para ownership por entidadId. */
export const AUDITORIA_ENTIDADES_POR_ID = [
  "TICKET",
  "USUARIO",
] as const satisfies ReadonlyArray<EntidadAuditoria>;

export type IsolatedRegistry = {
  runId: string;
  prefix: string;
  userIds: Set<string>;
  /** usuario login → id (para asserts). */
  userLogins: Map<string, string>;
  ticketIds: Set<string>;
  ticketLineaIds: Set<string>;
  movimientoIds: Set<string>;
  cuentaVendedorIds: Set<string>;
  sessionIds: Set<string>;
  auditoriaIds: Set<string>;
  cleanupAllowed: boolean;
};

export type VirtualControlConfig = {
  controlActivo: boolean;
  inicioEn: Date | null;
  umbralSaldoBajo?: Prisma.Decimal | null;
};

export type AuditOwnershipRow = {
  id: string;
  entidad: EntidadAuditoria;
  entidadId: string;
  usuarioId: string | null;
};

export type IsolatedCreditosContext = {
  db: IntegrationPrismaClient;
  registry: IsolatedRegistry;
  ahora: Date;
  /**
   * Store Prisma con config virtual (getConfig snapshot / saveConfig aborta).
   * Usar para asignar / consultar / corregir — nunca toca CreditosConfig real.
   */
  credits: CreditosStore;
  virtualControlOn: CreditosConfigView;
  virtualControlOff: CreditosConfigView;
  trackTicket: (id: string) => void;
  trackMovimiento: (id: string) => void;
  trackCuenta: (vendedorId: string) => void;
  bindCreditsWithVirtualConfig: (
    config: CreditosConfigView,
  ) => CreateTicketCreditsBinder;
  createAdmin: () => Promise<{ id: string; usuario: string }>;
  createVendedor: () => Promise<{ id: string; usuario: string }>;
  refreshOwnedTicketArtifacts: (ticketId: string) => Promise<void>;
  refreshOwnedMovimientosForVendedor: (vendedorId: string) => Promise<void>;
  /** Reincorpora recursos QA del run no trackeados (p. ej. tras crash). */
  recoverOwnedFromDatabase: () => Promise<void>;
  cleanupOwn: () => Promise<CleanupReport>;
  disconnect: () => Promise<void>;
};

export type CreateTicketCreditsBinder = (
  tx: Prisma.TransactionClient,
) => CreditosStore;

export type CleanupPlan = {
  movimientos: string[];
  cuentas: string[];
  ticketLineas: string[];
  auditorias: string[];
  sessions: string[];
  tickets: string[];
  users: string[];
};

export type CleanupReport = {
  cleaned: boolean;
  deletedMovimientos: number;
  deletedCuentas: number;
  deletedTicketLineas: number;
  deletedAuditorias: number;
  deletedSessions: number;
  deletedTickets: number;
  deletedUsers: number;
  planned: CleanupPlan;
};

/** runId canónico: base36(time) + "_" + 6 hex. Evita ambigüedad de prefijos. */
const RUN_ID_RE = /^[a-z0-9]+_[a-f0-9]{6}$/;

function newRunId(): string {
  return `${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

export function isCanonicalRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId);
}

export function buildRunPrefix(runId: string): string {
  if (!isCanonicalRunId(runId)) {
    throw new Error(
      `isolated-harness: runId inválido "${runId}" (se exige base36_hex6).`,
    );
  }
  return `${CREDITOS_QA_PREFIX}${runId}_`;
}

/**
 * Extrae runId canónico del login QA.
 * Formato: creditos_qa_<runId>_<suffix>
 */
export function extractRunIdFromUsuarioLogin(usuario: string): string | null {
  if (!usuario.startsWith(CREDITOS_QA_PREFIX)) return null;
  const rest = usuario.slice(CREDITOS_QA_PREFIX.length);
  const m = rest.match(/^([a-z0-9]+_[a-f0-9]{6})_/);
  return m?.[1] ?? null;
}

export function emptyRegistry(runId: string): IsolatedRegistry {
  return {
    runId,
    prefix: buildRunPrefix(runId),
    userIds: new Set(),
    userLogins: new Map(),
    ticketIds: new Set(),
    ticketLineaIds: new Set(),
    movimientoIds: new Set(),
    cuentaVendedorIds: new Set(),
    sessionIds: new Set(),
    auditoriaIds: new Set(),
    cleanupAllowed: false,
  };
}

export function emptyCleanupReport(): CleanupReport {
  return {
    cleaned: false,
    deletedMovimientos: 0,
    deletedCuentas: 0,
    deletedTicketLineas: 0,
    deletedAuditorias: 0,
    deletedSessions: 0,
    deletedTickets: 0,
    deletedUsers: 0,
    planned: {
      movimientos: [],
      cuentas: [],
      ticketLineas: [],
      auditorias: [],
      sessions: [],
      tickets: [],
      users: [],
    },
  };
}

/**
 * Login pertenece exactamente a este run (prefijo = creditos_qa_<runId>_).
 * Compara el runId extraído del login (canónico), no un startsWith ambiguo.
 */
export function usuarioLoginBelongsToExactRun(
  usuario: string,
  registry: Pick<IsolatedRegistry, "runId" | "prefix">,
): boolean {
  if (!isCanonicalRunId(registry.runId)) return false;
  const expected = buildRunPrefix(registry.runId);
  if (expected !== registry.prefix) return false;
  if (!usuario.startsWith(expected)) return false;
  const extracted = extractRunIdFromUsuarioLogin(usuario);
  return extracted === registry.runId;
}

export function assertOwnedUser(
  registry: IsolatedRegistry,
  user: { id: string; usuario: string },
): void {
  if (!registry.userIds.has(user.id)) {
    throw new Error(
      `isolated-harness: usuario ${user.id} no está en el registro del run.`,
    );
  }
  if (!usuarioLoginBelongsToExactRun(user.usuario, registry)) {
    throw new Error(
      `isolated-harness: usuario ${user.id} no tiene prefijo exacto del run (${registry.prefix}).`,
    );
  }
}

/**
 * Incorpora candidatos de usuario solo si el login es del run exacto.
 * Cualquier candidato ajeno → ABORT (no se mezcla con el plan).
 */
export function absorbRecoveredUsers(
  registry: IsolatedRegistry,
  candidates: Array<{ id: string; usuario: string }>,
): void {
  for (const u of candidates) {
    if (!usuarioLoginBelongsToExactRun(u.usuario, registry)) {
      throw new Error(
        `isolated-harness ABORT recover: usuario ${u.id} login="${u.usuario}" no pertenece al run ${registry.runId}.`,
      );
    }
    registry.userIds.add(u.id);
    registry.userLogins.set(u.usuario, u.id);
  }
}

/**
 * Tickets solo si vendedorId ∈ usuarios del run. Ajeno → ABORT.
 */
export function absorbRecoveredTickets(
  registry: IsolatedRegistry,
  tickets: Array<{ id: string; vendedorId: string | null }>,
): void {
  for (const t of tickets) {
    if (!t.vendedorId || !registry.userIds.has(t.vendedorId)) {
      throw new Error(
        `isolated-harness ABORT recover: ticket ${t.id} no atribuible a vendedores del run.`,
      );
    }
    registry.ticketIds.add(t.id);
  }
}

/**
 * Ownership de auditoría:
 * - usuarioId ∈ run, O
 * - entidad=TICKET y entidadId ∈ ticketIds del run, O
 * - entidad=USUARIO y entidadId ∈ userIds del run.
 * entidadId solo nunca basta; RESULTADO / AUTH / RESULTADO_PROGRAMADO
 * no otorgan ownership por entidadId.
 */
export function auditoriaOwnedByRun(
  audit: AuditOwnershipRow,
  registry: Pick<IsolatedRegistry, "userIds" | "ticketIds">,
): boolean {
  if (audit.usuarioId != null && registry.userIds.has(audit.usuarioId)) {
    return true;
  }
  if (
    audit.entidad === "TICKET" &&
    registry.ticketIds.has(audit.entidadId)
  ) {
    return true;
  }
  if (
    audit.entidad === "USUARIO" &&
    registry.userIds.has(audit.entidadId)
  ) {
    return true;
  }
  return false;
}

/** Añade al registry solo auditorías con ownership demostrado. */
export function absorbOwnedAuditorias(
  registry: IsolatedRegistry,
  audits: AuditOwnershipRow[],
): void {
  for (const a of audits) {
    if (auditoriaOwnedByRun(a, registry)) {
      registry.auditoriaIds.add(a.id);
    }
  }
}

export function buildVirtualCreditosConfig(
  args: VirtualControlConfig,
): CreditosConfigView {
  return {
    controlActivo: args.controlActivo,
    inicioEn: args.inicioEn,
    umbralSaldoBajo:
      args.umbralSaldoBajo === undefined ? null : args.umbralSaldoBajo,
    updatedAt: new Date(0),
    updatedByAdminId: null,
    /** Virtual: no hay fila persistida; venta usa este snapshot inyectado. */
    configPersisted: true,
  };
}

/**
 * Inyecta getConfig/saveConfig virtuales. saveConfig siempre falla.
 * Debe re-envolverse dentro de runInTransaction.
 */
export function wrapStoreWithVirtualConfig(
  base: CreditosStore,
  config: CreditosConfigView,
): CreditosStore {
  const wrap = (store: CreditosStore): CreditosStore => ({
    ...store,
    async getConfig() {
      return { ...config };
    },
    async saveConfig(): Promise<CreditosConfigView> {
      throw new Error(
        "isolated-harness: prohibido persistir CreditosConfig (suite aislada).",
      );
    },
    runInTransaction(fn) {
      return store.runInTransaction((tx) => fn(wrap(tx)));
    },
  });
  return wrap(base);
}

export function boomOnInsertTipo(
  base: CreditosStore,
  tipoBoom: string,
): CreditosStore {
  const wrap = (store: CreditosStore): CreditosStore => ({
    ...store,
    async runInTransaction(fn) {
      return store.runInTransaction((tx) => fn(wrap(tx)));
    },
    async insertMovimiento(mov) {
      if (mov.tipo === tipoBoom) {
        throw new Error(`forced-fail:${tipoBoom}`);
      }
      return store.insertMovimiento(mov);
    },
  });
  return wrap(base);
}

/**
 * Verifica el plan completo. Ante duda → throw (el caller no debe borrar).
 */
export function verifyCleanupPlanOwnership(
  registry: IsolatedRegistry,
  planned: CleanupPlan,
  snapshots: {
    users: Array<{ id: string; usuario: string } | null>;
    tickets: Array<{ id: string; vendedorId: string | null } | null>;
    movimientos: Array<{ id: string; vendedorId: string } | null>;
    lineas: Array<{ id: string; ticketId: string } | null>;
    sessions: Array<{ id: string; usuarioId: string } | null>;
    auditorias: Array<AuditOwnershipRow | null>;
  },
): void {
  for (const uid of planned.users) {
    const u = snapshots.users.find((x) => x?.id === uid) ?? null;
    if (!u) continue;
    assertOwnedUser(registry, u);
  }
  for (const tid of planned.tickets) {
    const t = snapshots.tickets.find((x) => x?.id === tid) ?? null;
    if (!t) continue;
    if (!t.vendedorId || !registry.userIds.has(t.vendedorId)) {
      throw new Error(
        `isolated-harness ABORT cleanup: ticket ${tid} no atribuible al run.`,
      );
    }
  }
  for (const mid of planned.movimientos) {
    const m = snapshots.movimientos.find((x) => x?.id === mid) ?? null;
    if (!m) continue;
    if (!registry.userIds.has(m.vendedorId)) {
      throw new Error(
        `isolated-harness ABORT cleanup: movimiento ${mid} no atribuible al run.`,
      );
    }
  }
  for (const vid of planned.cuentas) {
    if (!registry.userIds.has(vid)) {
      throw new Error(
        `isolated-harness ABORT cleanup: cuenta ${vid} no atribuible al run.`,
      );
    }
  }
  for (const lid of planned.ticketLineas) {
    const line = snapshots.lineas.find((x) => x?.id === lid) ?? null;
    if (!line) continue;
    if (!registry.ticketIds.has(line.ticketId)) {
      throw new Error(
        `isolated-harness ABORT cleanup: línea ${lid} no atribuible al run.`,
      );
    }
  }
  for (const sid of planned.sessions) {
    const s = snapshots.sessions.find((x) => x?.id === sid) ?? null;
    if (!s) continue;
    if (!registry.userIds.has(s.usuarioId)) {
      throw new Error(
        `isolated-harness ABORT cleanup: sesión ${sid} no atribuible al run.`,
      );
    }
  }
  for (const aid of planned.auditorias) {
    const a = snapshots.auditorias.find((x) => x?.id === aid) ?? null;
    if (!a) continue;
    if (!auditoriaOwnedByRun(a, registry)) {
      throw new Error(
        `isolated-harness ABORT cleanup: auditoría ${aid} no atribuible al run (entidad=${a.entidad}).`,
      );
    }
  }
}

/**
 * Orquesta cleanup: si planBuilder lanza, deleteFn NO se llama.
 * Exportado para unitarios sin Prisma.
 */
export async function runCleanupPhases(args: {
  registry: IsolatedRegistry;
  planBuilder: () => Promise<CleanupPlan>;
  deleteFn: (planned: CleanupPlan) => Promise<Omit<CleanupReport, "cleaned" | "planned">>;
}): Promise<CleanupReport> {
  if (!args.registry.cleanupAllowed) {
    return emptyCleanupReport();
  }
  const planned = await args.planBuilder();
  const counts = await args.deleteFn(planned);
  args.registry.cleanupAllowed = false;
  return { cleaned: true, planned, ...counts };
}

/**
 * Bootstrap aislado. No muta Animal/ConfigNegocio/CreditosConfig.
 * Exige animales 03/05 y MULTIPLICADOR_PREMIO ya presentes (solo lectura).
 */
export async function bootstrapIsolatedCreditos(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<IsolatedCreditosContext> {
  assertIntegrationPointsAtTestDatabase(env);
  const db = createIntegrationPrismaClient(env);
  const registry = emptyRegistry(newRunId());

  const animals = await db.animal.count({
    where: { numero: { in: [ANIMAL_A, ANIMAL_B] } },
  });
  if (animals < 2) {
    await db.$disconnect();
    throw new Error(
      "isolated-harness BLOCKED: faltan animales 03/05 en TEST (no se crean aquí).",
    );
  }
  const mult = await db.configNegocio.findUnique({
    where: { clave: "MULTIPLICADOR_PREMIO" },
  });
  if (!mult) {
    await db.$disconnect();
    throw new Error(
      "isolated-harness BLOCKED: falta ConfigNegocio MULTIPLICADOR_PREMIO.",
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
    throw new Error(
      "isolated-harness BLOCKED: schema de créditos ausente en TEST.",
    );
  }

  registry.cleanupAllowed = true;

  // Defensa ante residuos de auto-publish u otras suites en la fecha fixture:
  // aborta si el slot está ocupado (no borra resultados ajenos).
  await ensureCreditosSaleFixtureSlotsOpen(db);

  const virtualControlOn = buildVirtualCreditosConfig({
    controlActivo: true,
    inicioEn: new Date(AHORA_VE_MANANA.getTime() - 3600_000),
  });
  const virtualControlOff = buildVirtualCreditosConfig({
    controlActivo: false,
    inicioEn: null,
  });
  /** Barrera: asignar/consultar/corregir nunca leen ni escriben CreditosConfig real. */
  const credits = wrapStoreWithVirtualConfig(
    createPrismaCreditosStore(db),
    virtualControlOff,
  );

  async function createUser(args: {
    suffix: string;
    nombre: string;
    rol: "ADMIN" | "VENDEDOR";
  }): Promise<{ id: string; usuario: string }> {
    const usuario = `${registry.prefix}${args.suffix}`.slice(0, 40);
    const passwordHash = await hashPassword(CREDITOS_QA_PASSWORD);
    const row = await db.usuario.create({
      data: {
        nombre: args.nombre,
        usuario,
        passwordHash,
        rol: args.rol,
        activo: true,
      },
      select: { id: true, usuario: true },
    });
    registry.userIds.add(row.id);
    registry.userLogins.set(row.usuario, row.id);
    return row;
  }

  const ctx: IsolatedCreditosContext = {
    db,
    registry,
    ahora: AHORA_VE_MANANA,
    credits,
    virtualControlOn,
    virtualControlOff,
    trackTicket: (id) => registry.ticketIds.add(id),
    trackMovimiento: (id) => registry.movimientoIds.add(id),
    trackCuenta: (vendedorId) => registry.cuentaVendedorIds.add(vendedorId),
    bindCreditsWithVirtualConfig(config) {
      return (tx) =>
        wrapStoreWithVirtualConfig(
          createPrismaCreditosStore(tx, { alreadyInTransaction: true }),
          config,
        );
    },
    createAdmin: () =>
      createUser({
        suffix: `a${randomBytes(2).toString("hex")}`,
        nombre: "QA Creditos Admin",
        rol: "ADMIN",
      }),
    createVendedor: () =>
      createUser({
        suffix: `v${randomBytes(2).toString("hex")}`,
        nombre: "QA Creditos Vend",
        rol: "VENDEDOR",
      }),
    async refreshOwnedTicketArtifacts(ticketId) {
      if (!registry.ticketIds.has(ticketId)) {
        throw new Error(
          `isolated-harness: ticket ${ticketId} no registrado; no se rastrean artefactos.`,
        );
      }
      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, vendedorId: true },
      });
      if (!ticket) return;
      if (!ticket.vendedorId || !registry.userIds.has(ticket.vendedorId)) {
        throw new Error(
          `isolated-harness: ticket ${ticketId} no pertenece a usuarios del run.`,
        );
      }
      const lineas = await db.ticketLinea.findMany({
        where: { ticketId },
        select: { id: true },
      });
      for (const l of lineas) registry.ticketLineaIds.add(l.id);

      const audits = await db.auditoria.findMany({
        where: {
          OR: [
            { entidad: "TICKET", entidadId: ticketId },
            { entidad: "USUARIO", entidadId: ticket.vendedorId },
            { usuarioId: ticket.vendedorId },
          ],
        },
        select: {
          id: true,
          entidad: true,
          entidadId: true,
          usuarioId: true,
        },
      });
      absorbOwnedAuditorias(registry, audits);
    },
    async refreshOwnedMovimientosForVendedor(vendedorId) {
      if (!registry.userIds.has(vendedorId)) {
        throw new Error(
          `isolated-harness: vendedor ${vendedorId} no es del run.`,
        );
      }
      const movs = await db.creditoMovimiento.findMany({
        where: { vendedorId },
        select: { id: true },
      });
      for (const m of movs) registry.movimientoIds.add(m.id);
      const cuenta = await db.vendedorCreditoCuenta.findUnique({
        where: { vendedorId },
        select: { vendedorId: true },
      });
      if (cuenta) registry.cuentaVendedorIds.add(cuenta.vendedorId);
    },
    async recoverOwnedFromDatabase() {
      // 1) Usuarios cuyo login empieza por el prefijo exacto del run.
      const userRows = await db.usuario.findMany({
        where: { usuario: { startsWith: registry.prefix } },
        select: { id: true, usuario: true },
      });
      absorbRecoveredUsers(registry, userRows);

      const userIdList = [...registry.userIds];
      if (userIdList.length === 0) return;

      // 2) Tickets de esos vendedores (cubre trackTicket omitido).
      const ticketRows = await db.ticket.findMany({
        where: { vendedorId: { in: userIdList } },
        select: { id: true, vendedorId: true },
      });
      absorbRecoveredTickets(registry, ticketRows);

      const ticketIdList = [...registry.ticketIds];

      // 3) Líneas de tickets recuperados.
      if (ticketIdList.length > 0) {
        const lineas = await db.ticketLinea.findMany({
          where: { ticketId: { in: ticketIdList } },
          select: { id: true, ticketId: true },
        });
        for (const l of lineas) {
          if (!registry.ticketIds.has(l.ticketId)) {
            throw new Error(
              `isolated-harness ABORT recover: línea ${l.id} ticket ajeno.`,
            );
          }
          registry.ticketLineaIds.add(l.id);
        }
      }

      // 4) Movimientos y cuentas de vendedores del run.
      const movs = await db.creditoMovimiento.findMany({
        where: { vendedorId: { in: userIdList } },
        select: { id: true, vendedorId: true, ticketId: true },
      });
      for (const m of movs) {
        if (!registry.userIds.has(m.vendedorId)) {
          throw new Error(
            `isolated-harness ABORT recover: movimiento ${m.id} vendedor ajeno.`,
          );
        }
        if (m.ticketId != null && !registry.ticketIds.has(m.ticketId)) {
          // Movimiento con ticketId fuera del run → ambigüedad; no inventar.
          throw new Error(
            `isolated-harness ABORT recover: movimiento ${m.id} referencia ticket no recuperado del run.`,
          );
        }
        registry.movimientoIds.add(m.id);
      }
      const cuentas = await db.vendedorCreditoCuenta.findMany({
        where: { vendedorId: { in: userIdList } },
        select: { vendedorId: true },
      });
      for (const c of cuentas) {
        if (!registry.userIds.has(c.vendedorId)) {
          throw new Error(
            `isolated-harness ABORT recover: cuenta ${c.vendedorId} ajena.`,
          );
        }
        registry.cuentaVendedorIds.add(c.vendedorId);
      }

      // 5) Sesiones de usuarios del run.
      const sessions = await db.usuarioSesion.findMany({
        where: { usuarioId: { in: userIdList } },
        select: { id: true, usuarioId: true },
      });
      for (const s of sessions) {
        if (!registry.userIds.has(s.usuarioId)) {
          throw new Error(
            `isolated-harness ABORT recover: sesión ${s.id} usuario ajeno.`,
          );
        }
        registry.sessionIds.add(s.id);
      }

      // 6) Auditorías: filtrar por usuario del run O (entidad tipada + id).
      const auditOr: Prisma.AuditoriaWhereInput[] = [
        { usuarioId: { in: userIdList } },
      ];
      if (ticketIdList.length > 0) {
        auditOr.push({
          entidad: "TICKET",
          entidadId: { in: ticketIdList },
        });
      }
      auditOr.push({
        entidad: "USUARIO",
        entidadId: { in: userIdList },
      });
      const audits = await db.auditoria.findMany({
        where: { OR: auditOr },
        select: {
          id: true,
          entidad: true,
          entidadId: true,
          usuarioId: true,
        },
      });
      absorbOwnedAuditorias(registry, audits);
    },
    async cleanupOwn() {
      return runCleanupPhases({
        registry,
        planBuilder: async () => {
          // Recuperación + expansión; cualquier error de lectura aborta
          // antes de borrar (no .catch vacío).
          await ctx.recoverOwnedFromDatabase();

          for (const tid of [...registry.ticketIds]) {
            await ctx.refreshOwnedTicketArtifacts(tid);
          }
          for (const uid of [...registry.userIds]) {
            await ctx.refreshOwnedMovimientosForVendedor(uid);
            const sessions = await db.usuarioSesion.findMany({
              where: { usuarioId: uid },
              select: { id: true, usuarioId: true },
            });
            for (const s of sessions) {
              if (!registry.userIds.has(s.usuarioId)) {
                throw new Error(
                  `isolated-harness ABORT cleanup: sesión ${s.id} usuario ajeno.`,
                );
              }
              registry.sessionIds.add(s.id);
            }
            const audits = await db.auditoria.findMany({
              where: { usuarioId: uid },
              select: {
                id: true,
                entidad: true,
                entidadId: true,
                usuarioId: true,
              },
            });
            absorbOwnedAuditorias(registry, audits);
          }

          const planned: CleanupPlan = {
            movimientos: [...registry.movimientoIds],
            cuentas: [...registry.cuentaVendedorIds],
            ticketLineas: [...registry.ticketLineaIds],
            auditorias: [...registry.auditoriaIds],
            sessions: [...registry.sessionIds],
            tickets: [...registry.ticketIds],
            users: [...registry.userIds],
          };

          const [
            userSnaps,
            ticketSnaps,
            movSnaps,
            lineSnaps,
            sessionSnaps,
            auditSnaps,
          ] = await Promise.all([
            Promise.all(
              planned.users.map((id) =>
                db.usuario.findUnique({
                  where: { id },
                  select: { id: true, usuario: true },
                }),
              ),
            ),
            Promise.all(
              planned.tickets.map((id) =>
                db.ticket.findUnique({
                  where: { id },
                  select: { id: true, vendedorId: true },
                }),
              ),
            ),
            Promise.all(
              planned.movimientos.map((id) =>
                db.creditoMovimiento.findUnique({
                  where: { id },
                  select: { id: true, vendedorId: true },
                }),
              ),
            ),
            Promise.all(
              planned.ticketLineas.map((id) =>
                db.ticketLinea.findUnique({
                  where: { id },
                  select: { id: true, ticketId: true },
                }),
              ),
            ),
            Promise.all(
              planned.sessions.map((id) =>
                db.usuarioSesion.findUnique({
                  where: { id },
                  select: { id: true, usuarioId: true },
                }),
              ),
            ),
            Promise.all(
              planned.auditorias.map((id) =>
                db.auditoria.findUnique({
                  where: { id },
                  select: {
                    id: true,
                    entidad: true,
                    entidadId: true,
                    usuarioId: true,
                  },
                }),
              ),
            ),
          ]);

          verifyCleanupPlanOwnership(registry, planned, {
            users: userSnaps,
            tickets: ticketSnaps,
            movimientos: movSnaps,
            lineas: lineSnaps,
            sessions: sessionSnaps,
            auditorias: auditSnaps,
          });

          return planned;
        },
        deleteFn: async (planned) => {
          let deletedMovimientos = 0;
          let deletedCuentas = 0;
          let deletedTicketLineas = 0;
          let deletedAuditorias = 0;
          let deletedSessions = 0;
          let deletedTickets = 0;
          let deletedUsers = 0;

          // Solo IDs planificados. Nunca CreditosConfig / Animal /
          // ConfigNegocio / Resultado / TicketCounter / usuarios ajenos.
          if (planned.movimientos.length > 0) {
            const r = await db.creditoMovimiento.deleteMany({
              where: { id: { in: planned.movimientos } },
            });
            deletedMovimientos = r.count;
          }
          if (planned.cuentas.length > 0) {
            const r = await db.vendedorCreditoCuenta.deleteMany({
              where: { vendedorId: { in: planned.cuentas } },
            });
            deletedCuentas = r.count;
          }
          if (planned.ticketLineas.length > 0) {
            const r = await db.ticketLinea.deleteMany({
              where: { id: { in: planned.ticketLineas } },
            });
            deletedTicketLineas = r.count;
          }
          if (planned.auditorias.length > 0) {
            const r = await db.auditoria.deleteMany({
              where: { id: { in: planned.auditorias } },
            });
            deletedAuditorias = r.count;
          }
          if (planned.sessions.length > 0) {
            const r = await db.usuarioSesion.deleteMany({
              where: { id: { in: planned.sessions } },
            });
            deletedSessions = r.count;
          }
          if (planned.tickets.length > 0) {
            const r = await db.ticket.deleteMany({
              where: { id: { in: planned.tickets } },
            });
            deletedTickets = r.count;
          }
          if (planned.users.length > 0) {
            const r = await db.usuario.deleteMany({
              where: { id: { in: planned.users } },
            });
            deletedUsers = r.count;
          }

          return {
            deletedMovimientos,
            deletedCuentas,
            deletedTicketLineas,
            deletedAuditorias,
            deletedSessions,
            deletedTickets,
            deletedUsers,
          };
        },
      });
    },
    async disconnect() {
      await db.$disconnect();
    },
  };

  return ctx;
}

export type { CreatePrismaCreditosStoreOptions };
