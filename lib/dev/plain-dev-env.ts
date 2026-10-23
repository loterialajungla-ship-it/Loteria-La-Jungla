/**
 * Preparación del entorno hijo para `npm run dev` (wrapper seguro).
 * Solo lógica pura — sin arrancar Next.js.
 *
 * Next.js prioriza variables de proceso sobre `.env`. Por eso el hijo DEBE
 * recibir DATABASE_URL/DIRECT_URL ya validadas; nunca se asume que Next
 * resolverá el mismo destino que una comprobación parcial del padre.
 */

import {
  NEON_ENDPOINTS,
  extractNeonEndpointId,
} from "@/lib/db/neon-endpoint-guard";

export const PLAIN_DEV_ABORT_MESSAGE =
  "Se abortó npm run dev: destino de base de datos no seguro o ambiguo. Usa npm run dev:recovery (desarrollo recuperado) o npm run dev:test (TEST).";

export type PreparePlainDevEnvResult =
  | { ok: true; childEnv: NodeJS.ProcessEnv; endpointId: string }
  | { ok: false; reason: string };

const ALLOWED_PLAIN_DEV = new Set<string>([
  NEON_ENDPOINTS.DEV_RECOVERY,
  NEON_ENDPOINTS.TEST,
]);

/**
 * Valida el destino efectivo (DATABASE_URL + DIRECT_URL del env ya resuelto)
 * y construye childEnv forzando esas mismas URLs para que Next no pueda
 * sustituirlas por valores de `.env` distintos.
 */
export function preparePlainDevEnv(
  parentEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PreparePlainDevEnvResult {
  const databaseRaw = parentEnv.DATABASE_URL?.trim() ?? "";
  const directRaw = parentEnv.DIRECT_URL?.trim() ?? "";

  if (!databaseRaw || !directRaw) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (faltan DATABASE_URL y/o DIRECT_URL en el entorno efectivo).`,
    };
  }

  const dbEp = extractNeonEndpointId(databaseRaw);
  if (!dbEp.ok) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (DATABASE_URL: ${dbEp.reason})`,
    };
  }

  const dirEp = extractNeonEndpointId(directRaw);
  if (!dirEp.ok) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (DIRECT_URL: ${dirEp.reason})`,
    };
  }

  if (dbEp.endpointId !== dirEp.endpointId) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (DATABASE_URL y DIRECT_URL no comparten endpoint: ${dbEp.endpointId} vs ${dirEp.endpointId}).`,
    };
  }

  if (
    dbEp.endpointId === NEON_ENDPOINTS.PRODUCTION ||
    dbEp.endpointId === NEON_ENDPOINTS.RECOVERY
  ) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (endpoint prohibido ${dbEp.endpointId}).`,
    };
  }

  if (!ALLOWED_PLAIN_DEV.has(dbEp.endpointId)) {
    return {
      ok: false,
      reason: `${PLAIN_DEV_ABORT_MESSAGE} (endpoint desconocido o no autorizado ${dbEp.endpointId}).`,
    };
  }

  const childEnv: NodeJS.ProcessEnv = { ...parentEnv } as NodeJS.ProcessEnv;
  // Forzar el destino validado: Next no debe poder preferir otra URL de .env.
  childEnv.DATABASE_URL = databaseRaw;
  childEnv.DIRECT_URL = directRaw;

  return {
    ok: true,
    childEnv,
    endpointId: dbEp.endpointId,
  };
}

export function formatPlainDevBanner(endpointId: string): string {
  const label =
    endpointId === NEON_ENDPOINTS.DEV_RECOVERY
      ? "desarrollo recuperado (dev-from-recovery)"
      : endpointId === NEON_ENDPOINTS.TEST
        ? "TEST autorizado"
        : endpointId;
  return [
    "SAFE LOCAL DEV",
    `Endpoint validado: ${endpointId} (${label})`,
    "DATABASE_URL/DIRECT_URL forzados en el proceso hijo (coherentes con la validación).",
    "Producción y recovery original están bloqueados para npm run dev.",
  ].join("\n");
}
