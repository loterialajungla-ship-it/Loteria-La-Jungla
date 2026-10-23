/**
 * Preparación del entorno hijo para `npm run dev:recovery`.
 * Solo lógica pura — sin arrancar Next.js ni conectar a PostgreSQL.
 *
 * La validación de hostname Neon se delega en `extractNeonEndpointId`
 * (mismo criterio que el resto del proyecto).
 */

import { extractNeonEndpointId } from "@/lib/db/neon-endpoint-guard";

/** Endpoint Neon autorizado para la rama `dev-from-recovery`. */
export const DEV_RECOVERY_EXPECTED_ENDPOINT = "ep-delicate-river-b4n3lose";

export const DEV_RECOVERY_MISSING_POOLED_MESSAGE =
  "Falta DEV_FROM_RECOVERY_DATABASE_URL. Configúrala en la sesión (rama Neon dev-from-recovery, connection pooled) y vuelve a ejecutar.";

export const DEV_RECOVERY_MISSING_DIRECT_MESSAGE =
  "Falta DEV_FROM_RECOVERY_DIRECT_URL. Configúrala en la sesión (misma rama, connection directa sin pooler) y vuelve a ejecutar.";

export const DEV_RECOVERY_INVALID_URL_MESSAGE =
  "Se rechazó dev:recovery: una de las URLs de recuperación no es una URL PostgreSQL/Neon válida.";

export const DEV_RECOVERY_PROTOCOL_MESSAGE =
  "Se rechazó dev:recovery: las URLs deben usar el protocolo PostgreSQL (postgres o postgresql).";

export const DEV_RECOVERY_ENDPOINT_MESSAGE =
  "Se rechazó dev:recovery: el endpoint no coincide con el autorizado para desarrollo recuperado.";

export const DEV_RECOVERY_ENDPOINT_MISMATCH_MESSAGE =
  "Se rechazó dev:recovery: DEV_FROM_RECOVERY_DATABASE_URL y DEV_FROM_RECOVERY_DIRECT_URL no apuntan al mismo endpoint.";

export const DEV_RECOVERY_POOLER_ON_DIRECT_MESSAGE =
  "Se rechazó dev:recovery: DEV_FROM_RECOVERY_DIRECT_URL no debe usar el host pooler (-pooler).";

export const DEV_RECOVERY_COLLISION_MESSAGE =
  "Se rechazó dev:recovery: las URLs de recuperación coinciden con DATABASE_URL o DIRECT_URL del entorno (mismo endpoint o misma URL; posible producción).";

export type PrepareRecoveryDevEnvResult =
  | { ok: true; childEnv: NodeJS.ProcessEnv; endpointId: string }
  | { ok: false; reason: string };

export type ParsedRecoveryUrl =
  | {
      ok: true;
      normalized: string;
      endpointId: string;
      hasPoolerSuffix: boolean;
    }
  | { ok: false; reason: string };

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

/**
 * Parsea una URL de recuperación reutilizando el guard común de hosts Neon.
 * No incluye la URL ni credenciales en los mensajes de error.
 */
export function parseRecoveryPostgresUrl(raw: string): ParsedRecoveryUrl {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, reason: DEV_RECOVERY_INVALID_URL_MESSAGE };
  }

  // Mensaje de protocolo estable (contrato público de tests / callers).
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return { ok: false, reason: DEV_RECOVERY_PROTOCOL_MESSAGE };
  }

  const extracted = extractNeonEndpointId(trimmed);
  if (!extracted.ok) {
    if (/protocolo/i.test(extracted.reason)) {
      return { ok: false, reason: DEV_RECOVERY_PROTOCOL_MESSAGE };
    }
    return { ok: false, reason: DEV_RECOVERY_INVALID_URL_MESSAGE };
  }

  return {
    ok: true,
    normalized: normalizeUrl(trimmed),
    endpointId: extracted.endpointId,
    hasPoolerSuffix: extracted.hasPoolerSuffix,
  };
}

/**
 * True si alguna URL del padre (DATABASE/DIRECT) es la misma cadena o
 * resuelve al mismo endpoint ID que la recuperación validada.
 */
function parentCollidesWithRecovery(
  parentEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  recoveryEndpointId: string,
  recoveryNormalizedUrls: string[],
): boolean {
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = parentEnv[key]?.trim() ?? "";
    if (!raw) continue;

    const normalized = normalizeUrl(raw);
    if (recoveryNormalizedUrls.includes(normalized)) {
      return true;
    }

    const parentEp = extractNeonEndpointId(raw);
    if (parentEp.ok && parentEp.endpointId === recoveryEndpointId) {
      return true;
    }
  }
  return false;
}

/**
 * Valida las URLs de recuperación y construye el env del proceso hijo.
 * No muta `parentEnv`. No usa DATABASE_URL/DIRECT_URL como fallback de conexión.
 */
export function prepareRecoveryDevEnv(
  parentEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PrepareRecoveryDevEnvResult {
  const pooledRaw = parentEnv.DEV_FROM_RECOVERY_DATABASE_URL?.trim() ?? "";
  const directRaw = parentEnv.DEV_FROM_RECOVERY_DIRECT_URL?.trim() ?? "";

  if (!pooledRaw) {
    return { ok: false, reason: DEV_RECOVERY_MISSING_POOLED_MESSAGE };
  }
  if (!directRaw) {
    return { ok: false, reason: DEV_RECOVERY_MISSING_DIRECT_MESSAGE };
  }

  const pooled = parseRecoveryPostgresUrl(pooledRaw);
  if (!pooled.ok) {
    return { ok: false, reason: pooled.reason };
  }

  const direct = parseRecoveryPostgresUrl(directRaw);
  if (!direct.ok) {
    return { ok: false, reason: direct.reason };
  }

  if (direct.hasPoolerSuffix) {
    return { ok: false, reason: DEV_RECOVERY_POOLER_ON_DIRECT_MESSAGE };
  }

  if (pooled.endpointId !== direct.endpointId) {
    return { ok: false, reason: DEV_RECOVERY_ENDPOINT_MISMATCH_MESSAGE };
  }

  if (pooled.endpointId !== DEV_RECOVERY_EXPECTED_ENDPOINT) {
    return { ok: false, reason: DEV_RECOVERY_ENDPOINT_MESSAGE };
  }

  if (
    parentCollidesWithRecovery(parentEnv, pooled.endpointId, [
      pooled.normalized,
      direct.normalized,
    ])
  ) {
    return { ok: false, reason: DEV_RECOVERY_COLLISION_MESSAGE };
  }

  const childEnv: NodeJS.ProcessEnv = { ...parentEnv } as NodeJS.ProcessEnv;
  // Override obligatorio: nunca heredar conexiones de .env / padre para Prisma/Next.
  childEnv.DATABASE_URL = pooled.normalized;
  childEnv.DIRECT_URL = direct.normalized;
  childEnv.DEV_FROM_RECOVERY_DATABASE_URL = pooled.normalized;
  childEnv.DEV_FROM_RECOVERY_DIRECT_URL = direct.normalized;

  return {
    ok: true,
    childEnv,
    endpointId: pooled.endpointId,
  };
}

/** Banner de arranque — sin secretos ni cadenas de conexión. */
export function formatRecoveryDevBanner(endpointId: string): string {
  return [
    "RECOVERY DEVELOPMENT DATABASE",
    `Endpoint autorizado: ${endpointId}`,
    "Rama Neon: dev-from-recovery (desarrollo recuperado)",
    "(.env no se modifica; DATABASE_URL/DIRECT_URL de producción permanecen intactas en disco)",
    "Conexión del proceso hijo: solo DEV_FROM_RECOVERY_* validadas",
  ].join("\n");
}
