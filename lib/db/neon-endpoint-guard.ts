/**
 * Guard puro de endpoints Neon — sin Prisma, red ni lectura automática de .env.
 * Compara IDs de endpoint normalizados; nunca registra URLs ni credenciales.
 */

/** Endpoints confirmados del proyecto. */
export const NEON_ENDPOINTS = {
  PRODUCTION: "ep-spring-silence-b40xhu8w",
  RECOVERY: "ep-old-snow-b4sqg9p9",
  DEV_RECOVERY: "ep-delicate-river-b4n3lose",
  TEST: "ep-muddy-fire-b44816w0",
} as const;

export type NeonEndpointId =
  (typeof NEON_ENDPOINTS)[keyof typeof NEON_ENDPOINTS];

/** Destinos prohibidos para escrituras de prueba / seeds / resets. */
export const FORBIDDEN_WRITE_ENDPOINTS: ReadonlySet<string> = new Set([
  NEON_ENDPOINTS.PRODUCTION,
  NEON_ENDPOINTS.RECOVERY,
  NEON_ENDPOINTS.DEV_RECOVERY,
]);

/**
 * Hosts Neon observados en este proyecto:
 *   ep-<id>.c-<n>.<region>.aws.neon.tech
 *   ep-<id>-pooler.c-<n>.<region>.aws.neon.tech
 * No se acepta cualquier subdominio de neon.tech.
 */
export const NEON_COMPUTE_HOST_RE =
  /^ep-[a-z0-9-]+(-pooler)?\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/;

export type NeonGuardContext =
  | "integration-write"
  | "dev-recovery-bootstrap"
  | "any-non-forbidden";

export type ExtractEndpointResult =
  | { ok: true; endpointId: string; hasPoolerSuffix: boolean }
  | { ok: false; reason: string };

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function normalizeEndpointId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Extrae el ID de endpoint Neon (ep-…) de una connection string PostgreSQL.
 * No devuelve ni registra la URL.
 */
export function extractNeonEndpointId(
  connectionString: string | undefined | null,
): ExtractEndpointResult {
  const trimmed = connectionString?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: false,
      reason: "URL de conexión vacía o ausente.",
    };
  }

  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      reason:
        "La URL debe usar el protocolo PostgreSQL (postgres o postgresql).",
    };
  }

  let host: string;
  try {
    host = new URL(trimmed).hostname;
  } catch {
    return { ok: false, reason: "URL de conexión malformada." };
  }

  if (!host) {
    return { ok: false, reason: "URL de conexión sin host." };
  }

  const hostLower = host.toLowerCase();
  if (!NEON_COMPUTE_HOST_RE.test(hostLower)) {
    return {
      ok: false,
      reason:
        "Host Neon no reconocido (se espera ep-….c-N.region.aws.neon.tech o variante -pooler).",
    };
  }

  const firstLabel = hostLower.split(".")[0] ?? "";
  const hasPoolerSuffix = firstLabel.endsWith("-pooler");
  const endpointId = normalizeEndpointId(
    firstLabel.replace(/-pooler$/i, ""),
  );

  if (!/^ep-[a-z0-9-]+$/.test(endpointId)) {
    return {
      ok: false,
      reason: "No se pudo identificar un endpoint Neon válido (ep-…).",
    };
  }

  return { ok: true, endpointId, hasPoolerSuffix };
}

function contextLabel(context: NeonGuardContext): string {
  switch (context) {
    case "integration-write":
      return "integración/escritura";
    case "dev-recovery-bootstrap":
      return "bootstrap dev-from-recovery";
    default:
      return "operación";
  }
}

/**
 * Rechaza URLs inválidas o cuyo endpoint esté prohibido / no autorizado
 * para el contexto indicado.
 */
export function assertEndpointNotForbidden(
  connectionString: string | undefined | null,
  context: NeonGuardContext,
): string {
  const extracted = extractNeonEndpointId(connectionString);
  if (!extracted.ok) {
    throw new Error(
      `Guard Neon (${contextLabel(context)}): ${extracted.reason}`,
    );
  }

  const { endpointId } = extracted;

  if (context === "dev-recovery-bootstrap") {
    if (endpointId !== NEON_ENDPOINTS.DEV_RECOVERY) {
      throw new Error(
        `Guard Neon (${contextLabel(context)}): se exige el endpoint de desarrollo recuperado (${NEON_ENDPOINTS.DEV_RECOVERY}); recibido ${endpointId}.`,
      );
    }
    return endpointId;
  }

  if (FORBIDDEN_WRITE_ENDPOINTS.has(endpointId)) {
    throw new Error(
      `Guard Neon (${contextLabel(context)}): endpoint prohibido para escritura de prueba (${endpointId}).`,
    );
  }

  if (context === "integration-write") {
    if (endpointId !== NEON_ENDPOINTS.TEST) {
      throw new Error(
        `Guard Neon (${contextLabel(context)}): se exige el endpoint TEST autorizado (${NEON_ENDPOINTS.TEST}); recibido ${endpointId}.`,
      );
    }
  }

  return endpointId;
}

export type IntegrationWriteTargetResult = {
  testEndpointId: string;
  databaseEndpointId: string;
  directEndpointId: string | null;
};

/**
 * Autoriza escrituras de integración/acceptance/seed de test.
 * Exige TEST + DATABASE (y DIRECT si existe) en ep-muddy-fire-b44816w0.
 */
export function assertIntegrationWriteTarget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): IntegrationWriteTargetResult {
  const testRaw = env.TEST_DATABASE_URL?.trim() ?? "";
  const databaseRaw = env.DATABASE_URL?.trim() ?? "";
  const directRaw = env.DIRECT_URL?.trim() ?? "";

  if (!testRaw) {
    throw new Error(
      "Guard Neon (integración/escritura): falta TEST_DATABASE_URL.",
    );
  }
  if (!databaseRaw) {
    throw new Error(
      "Guard Neon (integración/escritura): falta DATABASE_URL (el runner debe inyectar TEST).",
    );
  }

  const testEp = extractNeonEndpointId(testRaw);
  if (!testEp.ok) {
    throw new Error(
      `Guard Neon (integración/escritura) TEST_DATABASE_URL: ${testEp.reason}`,
    );
  }

  const dbEp = extractNeonEndpointId(databaseRaw);
  if (!dbEp.ok) {
    throw new Error(
      `Guard Neon (integración/escritura) DATABASE_URL: ${dbEp.reason}`,
    );
  }

  for (const [label, ep] of [
    ["TEST_DATABASE_URL", testEp.endpointId],
    ["DATABASE_URL", dbEp.endpointId],
  ] as const) {
    if (FORBIDDEN_WRITE_ENDPOINTS.has(ep)) {
      throw new Error(
        `Guard Neon (integración/escritura): ${label} apunta a endpoint prohibido (${ep}).`,
      );
    }
    if (ep !== NEON_ENDPOINTS.TEST) {
      throw new Error(
        `Guard Neon (integración/escritura): ${label} debe ser ${NEON_ENDPOINTS.TEST}; recibido ${ep}.`,
      );
    }
  }

  if (testEp.endpointId !== dbEp.endpointId) {
    throw new Error(
      `Guard Neon (integración/escritura): TEST_DATABASE_URL (${testEp.endpointId}) y DATABASE_URL (${dbEp.endpointId}) no coinciden.`,
    );
  }

  let directEndpointId: string | null = null;
  if (directRaw) {
    const directEp = extractNeonEndpointId(directRaw);
    if (!directEp.ok) {
      throw new Error(
        `Guard Neon (integración/escritura) DIRECT_URL: ${directEp.reason}`,
      );
    }
    if (FORBIDDEN_WRITE_ENDPOINTS.has(directEp.endpointId)) {
      throw new Error(
        `Guard Neon (integración/escritura): DIRECT_URL apunta a endpoint prohibido (${directEp.endpointId}).`,
      );
    }
    if (directEp.endpointId !== NEON_ENDPOINTS.TEST) {
      throw new Error(
        `Guard Neon (integración/escritura): DIRECT_URL debe ser ${NEON_ENDPOINTS.TEST}; recibido ${directEp.endpointId}.`,
      );
    }
    directEndpointId = directEp.endpointId;
  }

  return {
    testEndpointId: testEp.endpointId,
    databaseEndpointId: dbEp.endpointId,
    directEndpointId,
  };
}

/**
 * Bootstrap de ADMIN solo contra desarrollo recuperado, con opt-in explícito.
 */
export function assertDevRecoveryBootstrapTarget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const target = env.BOOTSTRAP_TARGET?.trim().toLowerCase() ?? "";
  if (target !== "dev-from-recovery") {
    throw new Error(
      'Bootstrap abortado: define BOOTSTRAP_TARGET=dev-from-recovery y apunta DATABASE_URL/DIRECT_URL al endpoint de desarrollo recuperado. No se permite bootstrap implícito contra producción ni TEST.',
    );
  }

  const databaseRaw = env.DATABASE_URL?.trim() ?? "";
  if (!databaseRaw) {
    throw new Error(
      "Bootstrap abortado: falta DATABASE_URL tras autorizar BOOTSTRAP_TARGET.",
    );
  }

  const dbEp = extractNeonEndpointId(databaseRaw);
  if (!dbEp.ok) {
    throw new Error(`Bootstrap abortado (DATABASE_URL): ${dbEp.reason}`);
  }
  if (dbEp.endpointId !== NEON_ENDPOINTS.DEV_RECOVERY) {
    throw new Error(
      `Bootstrap abortado: DATABASE_URL debe ser ${NEON_ENDPOINTS.DEV_RECOVERY}; recibido ${dbEp.endpointId}.`,
    );
  }

  const directRaw = env.DIRECT_URL?.trim() ?? "";
  if (directRaw) {
    const directEp = extractNeonEndpointId(directRaw);
    if (!directEp.ok) {
      throw new Error(`Bootstrap abortado (DIRECT_URL): ${directEp.reason}`);
    }
    if (directEp.endpointId !== NEON_ENDPOINTS.DEV_RECOVERY) {
      throw new Error(
        `Bootstrap abortado: DIRECT_URL debe ser ${NEON_ENDPOINTS.DEV_RECOVERY}; recibido ${directEp.endpointId}.`,
      );
    }
  }

  return dbEp.endpointId;
}

/** Opt-in 1: destino lógico del bootstrap de producción. */
export const PRODUCTION_BOOTSTRAP_TARGET = "production";

/**
 * Opt-in 2: frase de confirmación explícita (no es un secreto de conexión).
 * Debe coincidir exactamente tras trim.
 */
export const CONFIRM_PRODUCTION_BOOTSTRAP_VALUE =
  "I_UNDERSTAND_THIS_WRITES_PRODUCTION";

/**
 * Bootstrap del primer ADMIN solo contra el endpoint PRODUCTION allowlisted.
 * Dual opt-in + DATABASE_URL y DIRECT_URL obligatorias y alineadas.
 * No debilita assertDevRecoveryBootstrapTarget ni los guards de TEST.
 * Nunca registra URLs ni credenciales.
 */
export function assertProductionBootstrapTarget(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const target = env.BOOTSTRAP_TARGET?.trim().toLowerCase() ?? "";
  if (target !== PRODUCTION_BOOTSTRAP_TARGET) {
    throw new Error(
      'Bootstrap de producción abortado: define BOOTSTRAP_TARGET=production y la confirmación explícita. No se permite bootstrap implícito.',
    );
  }

  const confirm = env.CONFIRM_PRODUCTION_BOOTSTRAP?.trim() ?? "";
  if (confirm !== CONFIRM_PRODUCTION_BOOTSTRAP_VALUE) {
    throw new Error(
      "Bootstrap de producción abortado: CONFIRM_PRODUCTION_BOOTSTRAP no coincide con la frase de confirmación documentada.",
    );
  }

  const databaseRaw = env.DATABASE_URL?.trim() ?? "";
  if (!databaseRaw) {
    throw new Error(
      "Bootstrap de producción abortado: falta DATABASE_URL tras autorizar el destino.",
    );
  }

  const directRaw = env.DIRECT_URL?.trim() ?? "";
  if (!directRaw) {
    throw new Error(
      "Bootstrap de producción abortado: DIRECT_URL es obligatoria y debe ser el endpoint de producción.",
    );
  }

  const dbEp = extractNeonEndpointId(databaseRaw);
  if (!dbEp.ok) {
    throw new Error(
      `Bootstrap de producción abortado (DATABASE_URL): ${dbEp.reason}`,
    );
  }

  const directEp = extractNeonEndpointId(directRaw);
  if (!directEp.ok) {
    throw new Error(
      `Bootstrap de producción abortado (DIRECT_URL): ${directEp.reason}`,
    );
  }

  if (dbEp.endpointId === NEON_ENDPOINTS.TEST) {
    throw new Error(
      "Bootstrap de producción abortado: el destino TEST no está permitido.",
    );
  }
  if (dbEp.endpointId === NEON_ENDPOINTS.RECOVERY) {
    throw new Error(
      "Bootstrap de producción abortado: el destino recovery no está permitido.",
    );
  }
  if (dbEp.endpointId === NEON_ENDPOINTS.DEV_RECOVERY) {
    throw new Error(
      "Bootstrap de producción abortado: el destino dev-from-recovery no está permitido. Usa bootstrap:admin.",
    );
  }

  if (dbEp.endpointId !== NEON_ENDPOINTS.PRODUCTION) {
    throw new Error(
      "Bootstrap de producción abortado: DATABASE_URL no es el endpoint de producción autorizado.",
    );
  }
  if (directEp.endpointId !== NEON_ENDPOINTS.PRODUCTION) {
    throw new Error(
      "Bootstrap de producción abortado: DIRECT_URL no es el endpoint de producción autorizado.",
    );
  }
  if (dbEp.endpointId !== directEp.endpointId) {
    throw new Error(
      "Bootstrap de producción abortado: DATABASE_URL y DIRECT_URL no coinciden.",
    );
  }

  return dbEp.endpointId;
}

/**
 * Valida que una URL de TEST (proceso padre) sea el endpoint autorizado.
 */
export function assertTestDatabaseUrlAuthorized(
  testDatabaseUrl: string | undefined | null,
): string {
  const extracted = extractNeonEndpointId(testDatabaseUrl);
  if (!extracted.ok) {
    throw new Error(`TEST_DATABASE_URL inválida: ${extracted.reason}`);
  }
  if (FORBIDDEN_WRITE_ENDPOINTS.has(extracted.endpointId)) {
    throw new Error(
      `TEST_DATABASE_URL apunta a endpoint prohibido (${extracted.endpointId}).`,
    );
  }
  if (extracted.endpointId !== NEON_ENDPOINTS.TEST) {
    throw new Error(
      `TEST_DATABASE_URL debe usar el endpoint TEST autorizado (${NEON_ENDPOINTS.TEST}); recibido ${extracted.endpointId}.`,
    );
  }
  return extracted.endpointId;
}

/**
 * Política cerrada para `prisma/seed.ts`.
 * No hay flujo automático legítimo en runners; exige opt-in explícito a TEST.
 */
export function assertPrismaSeedAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const target = env.PRISMA_SEED_TARGET?.trim().toLowerCase() ?? "";
  if (target !== "test") {
    throw new Error(
      "Seed abortado: no hay autorización implícita. Define PRISMA_SEED_TARGET=test y DATABASE_URL/DIRECT_URL al endpoint TEST autorizado. Producción, recovery y dev-from-recovery están prohibidos.",
    );
  }

  const databaseRaw = env.DATABASE_URL?.trim() ?? "";
  if (!databaseRaw) {
    throw new Error("Seed abortado: falta DATABASE_URL.");
  }

  const dbEp = extractNeonEndpointId(databaseRaw);
  if (!dbEp.ok) {
    throw new Error(`Seed abortado (DATABASE_URL): ${dbEp.reason}`);
  }
  if (FORBIDDEN_WRITE_ENDPOINTS.has(dbEp.endpointId)) {
    throw new Error(
      `Seed abortado: DATABASE_URL apunta a endpoint prohibido (${dbEp.endpointId}).`,
    );
  }
  if (dbEp.endpointId !== NEON_ENDPOINTS.TEST) {
    throw new Error(
      `Seed abortado: DATABASE_URL debe ser ${NEON_ENDPOINTS.TEST}; recibido ${dbEp.endpointId}.`,
    );
  }

  const directRaw = env.DIRECT_URL?.trim() ?? "";
  if (directRaw) {
    const directEp = extractNeonEndpointId(directRaw);
    if (!directEp.ok) {
      throw new Error(`Seed abortado (DIRECT_URL): ${directEp.reason}`);
    }
    if (directEp.endpointId !== NEON_ENDPOINTS.TEST) {
      throw new Error(
        `Seed abortado: DIRECT_URL debe ser ${NEON_ENDPOINTS.TEST}; recibido ${directEp.endpointId}.`,
      );
    }
  }

  const testRaw = env.TEST_DATABASE_URL?.trim() ?? "";
  if (testRaw) {
    const testEp = extractNeonEndpointId(testRaw);
    if (!testEp.ok || testEp.endpointId !== NEON_ENDPOINTS.TEST) {
      throw new Error(
        "Seed abortado: TEST_DATABASE_URL presente pero no apunta al endpoint TEST autorizado.",
      );
    }
  }

  return dbEp.endpointId;
}

/** Normaliza URL para comparaciones textuales auxiliares (sin secretos en logs). */
export function normalizeConnectionUrl(raw: string): string {
  return normalizeUrl(raw);
}
