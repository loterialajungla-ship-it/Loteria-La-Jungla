/**
 * Arranca Next.js en modo desarrollo contra la rama Neon `dev-from-recovery`.
 *
 * Uso:
 *   npm run dev:recovery
 *
 * Requisitos (sesión y/o `.env.recovery.local`; no DATABASE_URL de producción):
 *   DEV_FROM_RECOVERY_DATABASE_URL  — pooled, endpoint ep-delicate-river-b4n3lose
 *   DEV_FROM_RECOVERY_DIRECT_URL    — directa (sin -pooler), mismo endpoint
 *
 * Precedencia: variables de sesión > `.env.recovery.local` > error si faltan.
 *
 * - NO modifica .env
 * - NO ejecuta migraciones, seeds ni tests
 * - Inyecta DATABASE_URL/DIRECT_URL solo en el proceso hijo tras validar
 * - Multiplataforma (Windows / macOS / Linux)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  formatRecoveryDevBanner,
  prepareRecoveryDevEnv,
} from "../lib/dev/recovery-dev-env";
import {
  RECOVERY_LOCAL_ENV_FILENAME,
  loadRecoveryLocalEnvFile,
} from "../lib/dev/load-recovery-local-env";

const ROOT = path.resolve(__dirname, "..");

/**
 * Carga claves ausentes desde .env (p. ej. AUTH_SESSION_HOURS).
 * No sobrescribe variables ya definidas en la sesión.
 * Nunca usa DATABASE_URL/DIRECT_URL de .env como conexión de recuperación:
 * prepareRecoveryDevEnv exige DEV_FROM_RECOVERY_* y las escribe en el hijo.
 */
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
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

function main(): void {
  loadEnvFile(path.join(ROOT, ".env"));
  // Solo DEV_FROM_RECOVERY_*; nunca DATABASE_URL/DIRECT_URL desde este archivo.
  loadRecoveryLocalEnvFile(
    path.join(ROOT, RECOVERY_LOCAL_ENV_FILENAME),
    process.env,
  );

  const prepared = prepareRecoveryDevEnv(process.env);
  if (!prepared.ok) {
    console.error(prepared.reason);
    process.exit(1);
  }

  console.log(formatRecoveryDevBanner(prepared.endpointId));
  console.log("");

  const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextCli)) {
    console.error(
      "No se encontró next en node_modules. Ejecuta npm install en el proyecto.",
    );
    process.exit(1);
  }

  const child = spawn(process.execPath, [nextCli, "dev"], {
    cwd: ROOT,
    env: prepared.childEnv,
    stdio: "inherit",
  });

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

main();
