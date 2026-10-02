/**
 * Preparación del entorno hijo para `npm run dev:test` / `dev:test:lan`.
 * Solo lógica pura — sin arrancar Next.js.
 */

import os from "node:os";
import { checkSafeTestDatabase } from "@/lib/tickets/integration/safe-test-db";

export const DEV_TEST_PROD_COLLISION_MESSAGE =
  "Se rechazó dev:test: TEST_DATABASE_URL coincide con una base de datos de producción.";

export const DEV_TEST_DEFAULT_PORT = 3000;

export type PrepareTestDevEnvResult =
  | { ok: true; childEnv: NodeJS.ProcessEnv }
  | { ok: false; reason: string };

export type NetworkInterfacesLike = NodeJS.Dict<
  Array<{
    address: string;
    family: string | number;
    internal: boolean;
  }>
>;

export type TestDevBannerOptions = {
  /** Modo LAN: muestra URLs Local + LAN */
  lan?: boolean;
  port?: number;
  /** IPv4 LAN ya resuelta; si se omite y lan=true, se detecta */
  lanIp?: string | null;
};

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

/**
 * Valida TEST_DATABASE_URL y construye el env del proceso hijo
 * (DATABASE_URL / DIRECT_URL = TEST) sin mutar process.env del padre
 * ni tocar archivos .env.
 */
export function prepareTestDevEnv(
  parentEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PrepareTestDevEnvResult {
  const testRaw = parentEnv.TEST_DATABASE_URL?.trim() ?? "";
  if (!testRaw) {
    return {
      ok: false,
      reason:
        "Falta TEST_DATABASE_URL. Configura una PostgreSQL dedicada a tests (no la de producción).",
    };
  }

  const testUrl = normalizeUrl(testRaw);
  const databaseUrl = parentEnv.DATABASE_URL
    ? normalizeUrl(parentEnv.DATABASE_URL)
    : "";
  const directUrl = parentEnv.DIRECT_URL
    ? normalizeUrl(parentEnv.DIRECT_URL)
    : "";

  if (
    (databaseUrl && testUrl === databaseUrl) ||
    (directUrl && testUrl === directUrl)
  ) {
    return { ok: false, reason: DEV_TEST_PROD_COLLISION_MESSAGE };
  }

  const check = checkSafeTestDatabase(parentEnv);
  if (!check.ok) {
    // Mensajes genéricos del guard (p. ej. URL no postgres / señales prod).
    // Nunca incluir la URL completa (puede contener password).
    if (/coincide|aislada de producción/i.test(check.reason)) {
      return { ok: false, reason: DEV_TEST_PROD_COLLISION_MESSAGE };
    }
    return { ok: false, reason: check.reason };
  }

  const childEnv: NodeJS.ProcessEnv = { ...parentEnv } as NodeJS.ProcessEnv;
  childEnv.DATABASE_URL = check.testUrl;
  childEnv.DIRECT_URL = check.testUrl;
  // Next carga .env por defecto; forzamos override con estas vars de proceso.
  childEnv.TEST_DATABASE_URL = check.testUrl;

  return { ok: true, childEnv };
}

/** IPv4 privada RFC1918 (10/8, 172.16/12, 192.168/16). */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function privateIpv4Rank(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  return 2;
}

/**
 * Elige una IPv4 privada no interna de las interfaces activas.
 * Preferencia: 192.168.* → 10.* → 172.16-31.*.
 */
export function pickLanIpv4(
  interfaces: NetworkInterfacesLike = os.networkInterfaces() as NetworkInterfacesLike,
): string | null {
  const candidates: string[] = [];
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (!isIpv4Family(info.family)) continue;
      if (info.internal) continue;
      if (!isPrivateIpv4(info.address)) continue;
      candidates.push(info.address);
    }
  }
  candidates.sort(
    (x, y) => privateIpv4Rank(x) - privateIpv4Rank(y) || x.localeCompare(y),
  );
  return candidates[0] ?? null;
}

/** Banner de arranque — sin secretos ni URL de base de datos. */
export function formatTestDevBanner(options?: TestDevBannerOptions): string {
  const lines = [
    "TEST DEVELOPMENT DATABASE",
    "Base de datos: TEST_DATABASE_URL",
    "(.env no se modifica; DATABASE_URL/DIRECT_URL de producción permanecen intactas en disco)",
  ];

  if (options?.lan) {
    const port = options.port ?? DEV_TEST_DEFAULT_PORT;
    const lanIp =
      options.lanIp === undefined ? pickLanIpv4() : options.lanIp;

    lines.push("");
    lines.push("Local:");
    lines.push(`http://localhost:${port}`);
    lines.push("");
    lines.push("LAN:");
    if (lanIp) {
      lines.push(`http://${lanIp}:${port}`);
    } else {
      lines.push(
        "(no se detectó IPv4 privada; comprueba que el PC esté en Wi-Fi/LAN)",
      );
    }
    lines.push("");
    lines.push(
      "Solo red local de confianza. No uses este modo en Wi-Fi público.",
    );
    lines.push("Escucha: 0.0.0.0 (accesible en la misma red Wi-Fi).");
    lines.push(
      "Abre Local o LAN de arriba. No abras http://0.0.0.0:… en el navegador.",
    );
  }

  return lines.join("\n");
}
