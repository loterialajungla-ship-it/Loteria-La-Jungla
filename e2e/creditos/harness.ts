/**
 * Harness E2E créditos — datos aislados prefijo fase53_e2e_.
 * Solo TEST. Limpieza por IDs de la ejecución. No borra Auditoria ni fase5_*.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../lib/auth/password";
import {
  NEON_ENDPOINTS,
  assertIntegrationWriteTarget,
} from "../../lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "../../lib/tickets/integration/safe-test-db";

export const E2E_PREFIX = "fase53_e2e_";
export const E2E_PASSWORD = "testpass12";
export const STATE_PATH = path.join(__dirname, ".run-state.json");

export type E2eRunState = {
  runId: string;
  endpointId: string;
  adminId: string;
  adminUsuario: string;
  vendId: string;
  vendUsuario: string;
  vend2Id: string;
  vend2Usuario: string;
  password: string;
};

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

export function prepareE2eTestEnv(): {
  env: NodeJS.ProcessEnv;
  endpointId: string;
  databaseUrl: string;
} {
  loadEnvFile(path.join(__dirname, "..", "..", ".env"));
  const testUrl = assertSafeTestDatabase(process.env);
  const direct = testUrl.replace(/-pooler\./i, ".");
  const env = {
    ...process.env,
    TEST_DATABASE_URL: testUrl,
    DATABASE_URL: direct,
    DIRECT_URL: direct,
  } as NodeJS.ProcessEnv;
  const g = assertIntegrationWriteTarget(env);
  if (g.databaseEndpointId !== NEON_ENDPOINTS.TEST) {
    throw new Error("E2E ABORT: no TEST");
  }
  return { env, endpointId: g.databaseEndpointId, databaseUrl: direct };
}

export async function bootstrapE2eUsers(): Promise<E2eRunState> {
  const { env, endpointId, databaseUrl } = prepareE2eTestEnv();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const passwordHash = await hashPassword(E2E_PASSWORD);

  try {
    const adminUsuario = `${E2E_PREFIX}${runId}_adm`.slice(0, 40);
    const vendUsuario = `${E2E_PREFIX}${runId}_v1`.slice(0, 40);
    const vend2Usuario = `${E2E_PREFIX}${runId}_v2`.slice(0, 40);

    const admin = await db.usuario.create({
      data: {
        nombre: "F53 E2E Admin",
        usuario: adminUsuario,
        passwordHash,
        rol: "ADMIN",
        activo: true,
      },
    });
    const vend = await db.usuario.create({
      data: {
        nombre: "F53 E2E Vend",
        usuario: vendUsuario,
        passwordHash,
        rol: "VENDEDOR",
        activo: true,
      },
    });
    const vend2 = await db.usuario.create({
      data: {
        nombre: "F53 E2E Vend2",
        usuario: vend2Usuario,
        passwordHash,
        rol: "VENDEDOR",
        activo: true,
      },
    });

    const state: E2eRunState = {
      runId,
      endpointId,
      adminId: admin.id,
      adminUsuario,
      vendId: vend.id,
      vendUsuario,
      vend2Id: vend2.id,
      vend2Usuario,
      password: E2E_PASSWORD,
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    // Avoid unused env lint in callers that only need state
    void env;
    return state;
  } finally {
    await db.$disconnect();
  }
}

export function readE2eState(): E2eRunState {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error("Falta e2e/creditos/.run-state.json — globalSetup no corrió.");
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as E2eRunState;
}

/**
 * Limpia solo cuentas/movimientos/tickets/sesiones de los IDs de esta corrida.
 * No borra Auditoria ni usuarios (pueden quedar residuales identificables).
 */
export async function cleanupE2eFinancials(state: E2eRunState): Promise<{
  deletedMovimientos: number;
  deletedCuentas: number;
  deletedTickets: number;
  deletedSessions: number;
}> {
  const { databaseUrl } = prepareE2eTestEnv();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const userIds = [state.adminId, state.vendId, state.vend2Id];
  try {
    const tickets = await db.ticket.findMany({
      where: { vendedorId: { in: userIds } },
      select: { id: true },
    });
    const ticketIds = tickets.map((t) => t.id);
    if (ticketIds.length > 0) {
      await db.ticketLinea.deleteMany({ where: { ticketId: { in: ticketIds } } });
    }
    const tdel =
      ticketIds.length > 0
        ? await db.ticket.deleteMany({ where: { id: { in: ticketIds } } })
        : { count: 0 };
    const movDel = await db.creditoMovimiento.deleteMany({
      where: { vendedorId: { in: userIds } },
    });
    const cueDel = await db.vendedorCreditoCuenta.deleteMany({
      where: { vendedorId: { in: userIds } },
    });
    const sdel = await db.usuarioSesion.deleteMany({
      where: { usuarioId: { in: userIds } },
    });
    return {
      deletedMovimientos: movDel.count,
      deletedCuentas: cueDel.count,
      deletedTickets: tdel.count,
      deletedSessions: sdel.count,
    };
  } finally {
    await db.$disconnect();
  }
}

export async function countMovimientosFor(
  vendedorId: string,
): Promise<number> {
  const { databaseUrl } = prepareE2eTestEnv();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    return await db.creditoMovimiento.count({ where: { vendedorId } });
  } finally {
    await db.$disconnect();
  }
}

export async function readSaldo(vendedorId: string): Promise<string | null> {
  const { databaseUrl } = prepareE2eTestEnv();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const c = await db.vendedorCreditoCuenta.findUnique({
      where: { vendedorId },
    });
    return c ? c.saldoDisponible.toFixed(2) : null;
  } finally {
    await db.$disconnect();
  }
}
