/**
 * Arranca Next.js en modo desarrollo contra TEST_DATABASE_URL.
 *
 * Uso:
 *   npm run dev:test
 *   npm run dev:test:lan   → escucha en 0.0.0.0 (misma Wi-Fi)
 *
 * - NO modifica .env
 * - Inyecta DATABASE_URL/DIRECT_URL solo en el proceso hijo
 * - Multiplataforma (Windows / macOS / Linux)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEV_TEST_DEFAULT_PORT,
  formatTestDevBanner,
  pickLanIpv4,
  prepareTestDevEnv,
} from "../lib/dev/test-dev-env";

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

function wantsLanMode(argv: string[]): boolean {
  return argv.includes("--lan");
}

function main(): void {
  loadEnvFile(path.join(ROOT, ".env"));

  const prepared = prepareTestDevEnv(process.env);
  if (!prepared.ok) {
    console.error(prepared.reason);
    process.exit(1);
  }

  const lan = wantsLanMode(process.argv.slice(2));
  const port = DEV_TEST_DEFAULT_PORT;
  const lanIp = lan ? pickLanIpv4() : null;

  console.log(
    formatTestDevBanner(
      lan
        ? { lan: true, port, lanIp }
        : undefined,
    ),
  );
  console.log("");

  const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextCli)) {
    console.error(
      "No se encontró next en node_modules. Ejecuta npm install en el proyecto.",
    );
    process.exit(1);
  }

  const nextArgs = [nextCli, "dev"];
  if (lan) {
    // Host 0.0.0.0; puerto por defecto 3000 (Next elige otro si está ocupado).
    nextArgs.push("-H", "0.0.0.0");
  }

  const child = spawn(process.execPath, nextArgs, {
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
