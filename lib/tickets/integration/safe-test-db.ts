/**
 * Guard de seguridad para tests de integración PostgreSQL.
 * Nunca usar DATABASE_URL / DIRECT_URL de producción.
 */

export type SafeTestDbCheck = {
  ok: true;
  testUrl: string;
} | {
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
 * Valida que TEST_DATABASE_URL exista y esté aislada de prod.
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
      reason: "TEST_DATABASE_URL debe ser una URL PostgreSQL (postgresql://...).",
    };
  }

  const testUrl = normalizeUrl(testRaw);
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
