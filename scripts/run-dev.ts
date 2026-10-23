/**
 * Wrapper seguro de `npm run dev`.
 *
 * - Carga `.env` solo para claves ausentes (como Next).
 * - Valida DATABASE_URL + DIRECT_URL del entorno efectivo.
 * - Aborta si el destino es producción, recovery, desconocido o ambiguo.
 * - Arranca Next con DATABASE_URL/DIRECT_URL forzados al valor validado
 *   (evita que Next resuelva otra URL desde `.env`).
 *
 * Preferir `npm run dev:recovery` para desarrollo recuperado.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  formatPlainDevBanner,
  preparePlainDevEnv,
} from "../lib/dev/plain-dev-env";

const ROOT = path.resolve(__dirname, "..");

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

  const prepared = preparePlainDevEnv(process.env);
  if (!prepared.ok) {
    console.error(prepared.reason);
    process.exit(1);
  }

  console.log(formatPlainDevBanner(prepared.endpointId));
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
