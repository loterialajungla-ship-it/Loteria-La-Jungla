/**
 * Harness de integración/aceptación.
 *
 * - Crear clientes solo con `createIntegrationPrismaClient` (valida destino TEST
 *   vía `assertIntegrationWriteTarget` antes de `new PrismaClient`).
 * - `seedMinimalBusiness` / `createTestUser` / cleanup owned exigen la
 *   marca de fábrica + entorno aún alineado con TEST.
 * - `resetTicketDomain` (wipe global) fue eliminado en FASE 7.74.
 * - No usar `@/lib/prisma` en estas rutas de escritura del harness.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import {
  NEON_ENDPOINTS,
  assertIntegrationWriteTarget,
} from "@/lib/db/neon-endpoint-guard";

/** 2026-10-02 12:00 UTC ≈ 08:00 America/Caracas → horas 9–19 abiertas. */
export const AHORA_VE_MANANA = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));

/** Medianoche UTC del día de juego fijo de las pruebas. */
export function fechaJuegoDate(): Date {
  return new Date(Date.UTC(2026, 9, 2));
}

export function fechaJuegoTest(): string {
  return fechaAYYYYMMDD(fechaJuegoDate());
}

const ANIMALES_MIN = [
  { numero: "03", nombre: "Ciempiés" },
  { numero: "05", nombre: "León" },
  { numero: "15", nombre: "Zorro" },
  { numero: "00", nombre: "Ballena" },
] as const;

/**
 * Marca de fábrica: Prisma no expone la URL efectiva de un cliente ya creado
 * vía API pública estable (5.22). Solo clientes creados por
 * `createIntegrationPrismaClient` llevan esta marca.
 */
export const INTEGRATION_PRISMA_BRAND = Symbol.for(
  "llj.integrationPrismaClient",
);

export type IntegrationPrismaClient = PrismaClient & {
  readonly [INTEGRATION_PRISMA_BRAND]: typeof NEON_ENDPOINTS.TEST;
};

/**
 * Crea un PrismaClient de integración tras validar el entorno.
 * El URL inyectado es el DATABASE_URL ya autorizado (TEST).
 */
export function createIntegrationPrismaClient(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): IntegrationPrismaClient {
  assertIntegrationWriteTarget(env);
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "createIntegrationPrismaClient: falta DATABASE_URL tras validación.",
    );
  }

  const client = new PrismaClient({
    datasources: { db: { url } },
  });

  Object.defineProperty(client, INTEGRATION_PRISMA_BRAND, {
    value: NEON_ENDPOINTS.TEST,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return client as IntegrationPrismaClient;
}

/**
 * Exige un cliente creado por la fábrica + entorno aún alineado con TEST.
 * Rechaza clientes genéricos (p. ej. `@/lib/prisma` o overrides opacos).
 */
export function assertIntegrationPrismaClient(
  db: PrismaClient,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): asserts db is IntegrationPrismaClient {
  const brand = (db as IntegrationPrismaClient)[INTEGRATION_PRISMA_BRAND];
  if (brand !== NEON_ENDPOINTS.TEST) {
    throw new Error(
      "Operación de integración abortada: el PrismaClient no está verificado. Usa createIntegrationPrismaClient() (no se puede confiar en un cliente con destino opaco).",
    );
  }

  const target = assertIntegrationWriteTarget(env);
  if (target.databaseEndpointId !== brand) {
    throw new Error(
      `Operación de integración abortada: discrepancia entre cliente verificado (${brand}) y entorno (${target.databaseEndpointId}).`,
    );
  }
}

/**
 * @deprecated FASE 7.74 — el wipe global fue eliminado.
 * Usar `cleanupOwnedTicketDomain` / `createOwnedTicketDomain` en
 * `owned-ticket-domain.ts`. Esta función lanza siempre.
 */
export async function resetTicketDomain(_db?: PrismaClient): Promise<void> {
  void _db;
  throw new Error(
    "resetTicketDomain eliminado (FASE 7.74): use createOwnedTicketDomain + " +
      "cleanupOwnedTicketDomain (solo IDs propios). No hay wipe global.",
  );
}

export async function seedMinimalBusiness(db: PrismaClient): Promise<void> {
  assertIntegrationPrismaClient(db);

  for (const a of ANIMALES_MIN) {
    await db.animal.upsert({
      where: { numero: a.numero },
      update: { nombre: a.nombre },
      create: {
        numero: a.numero,
        nombre: a.nombre,
        imagen: `/animals/${a.numero}.png`,
      },
    });
  }

  await db.configNegocio.upsert({
    where: { clave: "MULTIPLICADOR_PREMIO" },
    update: { valorInt: 30 },
    create: { clave: "MULTIPLICADOR_PREMIO", valorInt: 30 },
  });
}

export async function createTestUser(
  db: PrismaClient,
  args: {
    usuario: string;
    nombre: string;
    rol: "ADMIN" | "VENDEDOR";
    password?: string;
  },
): Promise<{ id: string; usuario: string; rol: "ADMIN" | "VENDEDOR" }> {
  assertIntegrationPrismaClient(db);

  const passwordHash = await hashPassword(args.password ?? "testpass12");
  const row = await db.usuario.create({
    data: {
      nombre: args.nombre,
      usuario: args.usuario.toLowerCase(),
      passwordHash,
      rol: args.rol,
      activo: true,
    },
    select: { id: true, usuario: true, rol: true },
  });
  return row;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
