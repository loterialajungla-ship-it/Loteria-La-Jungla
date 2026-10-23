/**
 * Guard de seguridad para tests de integración PostgreSQL.
 * Nunca usar DATABASE_URL / DIRECT_URL de producción.
 */

import {
  extractNeonEndpointId,
  assertTestDatabaseUrlAuthorized,
} from "@/lib/db/neon-endpoint-guard";

export type SafeTestDbCheck =
  | {
      ok: true;
      testUrl: string;
    }
  | {
      ok: false;
      reason: string;
    };

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function looksLikeProduction(url: string): boolean {
  const u = url.toLowerCase();
  // Señales típicas de prod; no exhaustivo, refuerza el check de igualdad.
  if (u.includes("prod") && !u.includes("test")) return true;
  if (u.includes("production")) return true;
  return false;
}

/**
 * Valida que TEST_DATABASE_URL exista, sea el endpoint TEST autorizado
 * y esté aislada de prod/recovery/dev-recovery (por ID de endpoint, no solo igualdad textual).
 */
export function checkSafeTestDatabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SafeTestDbCheck {
  const testRaw = env.TEST_DATABASE_URL?.trim() ?? "";
  if (!testRaw) {
    return {
      ok: false,
      reason:
        "Falta TEST_DATABASE_URL. Configura una PostgreSQL dedicada a tests (no la de producción).",
    };
  }

  if (!/^postgres(ql)?:\/\//i.test(testRaw)) {
    return {
      ok: false,
      reason:
        "TEST_DATABASE_URL debe ser una URL PostgreSQL (protocolo postgres o postgresql).",
    };
  }

  try {
    assertTestDatabaseUrlAuthorized(testRaw);
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const testUrl = normalizeUrl(testRaw);
  const testEp = extractNeonEndpointId(testRaw);
  if (!testEp.ok) {
    return { ok: false, reason: testEp.reason };
  }

  const databaseUrl = env.DATABASE_URL ? normalizeUrl(env.DATABASE_URL) : "";
  const directUrl = env.DIRECT_URL ? normalizeUrl(env.DIRECT_URL) : "";

  if (databaseUrl && testUrl === databaseUrl) {
    return {
      ok: false,
      reason:
        "Se rechazó la ejecución: la base de datos de test no parece aislada de producción. (TEST_DATABASE_URL === DATABASE_URL)",
    };
  }

  if (directUrl && testUrl === directUrl) {
    return {
      ok: false,
      reason:
        "Se rechazó la ejecución: la base de datos de test no parece aislada de producción. (TEST_DATABASE_URL === DIRECT_URL)",
    };
  }

  // Colisión por endpoint ID (URLs distintas, mismo compute Neon).
  if (databaseUrl) {
    const dbEp = extractNeonEndpointId(databaseUrl);
    if (dbEp.ok && dbEp.endpointId === testEp.endpointId) {
      return {
        ok: false,
        reason:
          "Se rechazó la ejecución: TEST_DATABASE_URL y DATABASE_URL comparten el mismo endpoint Neon (posible producción).",
      };
    }
  }
  if (directUrl) {
    const dirEp = extractNeonEndpointId(directUrl);
    if (dirEp.ok && dirEp.endpointId === testEp.endpointId) {
      return {
        ok: false,
        reason:
          "Se rechazó la ejecución: TEST_DATABASE_URL y DIRECT_URL comparten el mismo endpoint Neon (posible producción).",
      };
    }
  }

  if (looksLikeProduction(testUrl) && !/test|ci|local|dev/i.test(testUrl)) {
    return {
      ok: false,
      reason:
        "Se rechazó la ejecución: la base de datos de test no parece aislada de producción.",
    };
  }

  return { ok: true, testUrl };
}

export function assertSafeTestDatabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const check = checkSafeTestDatabase(env);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return check.testUrl;
}
