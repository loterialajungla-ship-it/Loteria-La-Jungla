/**
 * Crea o actualiza ÚNICAMENTE un Usuario ADMIN de prueba en la BD TEST.
 *
 * Uso:
 *   $env:ENSURE_TEST_ADMIN="1"
 *   $env:MANUAL_TEST_ADMIN_USER="manual_admin"
 *   $env:MANUAL_TEST_ADMIN_PASSWORD="…"   # no se imprime
 *   npm run ensure:test-admin
 *
 * - Solo endpoint TEST autorizado (ep-muddy-fire-b44816w0)
 * - NO acepta URL por CLI
 * - NO toca animales, config, vendedores, tickets, resultados ni sesiones
 * - NO modifica bootstrap-admin ni escribe en prod/recovery/dev-recovery
 * - Errores: mensajes/etapas fijas; nunca URL/host/credenciales/hash/e.message
 */

import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { assertIntegrationWriteTarget } from "../lib/db/neon-endpoint-guard";
import { hashPassword } from "../lib/auth/password";
import {
  EnsureTestAdminError,
  assertEnsureTestAdminOptIn,
  assertEnsureUpdateFieldsSafe,
  parseEnsureTestAdminCredentials,
  planEnsureTestAdminUser,
} from "../lib/dev/ensure-test-admin";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

const ROOT = path.resolve(__dirname, "..");

const MSG_UNEXPECTED =
  "ensure:test-admin: error inesperado. Verifica ENSURE_TEST_ADMIN=1, MANUAL_TEST_ADMIN_USER, MANUAL_TEST_ADMIN_PASSWORD y que TEST_DATABASE_URL sea el endpoint TEST autorizado. No se mostraron detalles internos.";

const MSG_TEST_DB_REJECTED =
  "Se abortó ensure:test-admin: TEST_DATABASE_URL ausente, inválida o no es el endpoint TEST autorizado aislado.";

const MSG_WRITE_TARGET_REJECTED =
  "Se abortó ensure:test-admin: el destino de escritura no pasó la validación de endpoint TEST.";

const MSG_CLI_ARGS =
  "ensure:test-admin no acepta argumentos. Usa solo variables de entorno.";

/** Etiquetas fijas de diagnóstico (sin detalles internos). */
const STAGE_ENV = "STAGE_ENV";
const STAGE_TEST_TARGET = "STAGE_TEST_TARGET";
const STAGE_PRISMA_INIT = "STAGE_PRISMA_INIT";
const STAGE_HASH = "STAGE_HASH";
const STAGE_READ_USER = "STAGE_READ_USER";
const STAGE_WRITE_USER = "STAGE_WRITE_USER";
const STAGE_DOMAIN = "STAGE_DOMAIN";

function printExpected(message: string): void {
  console.error(message);
}

function printUnexpected(): void {
  console.error(MSG_UNEXPECTED);
}

function printStageFail(stage: string): void {
  console.error(
    `ensure:test-admin: fallo en ${stage} (sin detalles internos).`,
  );
}

function printDomainFail(message: string): void {
  printStageFail(STAGE_DOMAIN);
  printExpected(message);
}

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

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    printExpected(MSG_CLI_ARGS);
    process.exit(1);
  }

  loadEnvFile(path.join(ROOT, ".env"));

  let credentials;
  try {
    assertEnsureTestAdminOptIn(process.env);
    credentials = parseEnsureTestAdminCredentials(process.env);
  } catch (e) {
    if (e instanceof EnsureTestAdminError) {
      printDomainFail(e.message);
    } else {
      printStageFail(STAGE_ENV);
    }
    process.exit(1);
  }

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch {
    printStageFail(STAGE_TEST_TARGET);
    printExpected(MSG_TEST_DB_REJECTED);
    process.exit(1);
  }

  process.env.TEST_DATABASE_URL = testUrl;
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = testUrl;

  try {
    assertIntegrationWriteTarget(process.env);
  } catch {
    printExpected(MSG_WRITE_TARGET_REJECTED);
    process.exit(1);
  }

  let db: PrismaClient | null = null;

  try {
    try {
      const { PrismaClient: PrismaClientCtor } = await import("@prisma/client");
      db = new PrismaClientCtor({
        datasources: { db: { url: testUrl } },
      });
    } catch {
      printStageFail(STAGE_PRISMA_INIT);
      process.exit(1);
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(credentials.password);
    } catch {
      printStageFail(STAGE_HASH);
      process.exit(1);
    }

    let existing;
    try {
      existing = await db.usuario.findUnique({
        where: { usuario: credentials.usuario },
        select: {
          id: true,
          usuario: true,
          rol: true,
          activo: true,
          nombre: true,
        },
      });
    } catch {
      printStageFail(STAGE_READ_USER);
      process.exit(1);
    }

    let plan;
    try {
      plan = planEnsureTestAdminUser({
        existing,
        usuario: credentials.usuario,
        passwordHash,
      });
    } catch (e) {
      if (e instanceof EnsureTestAdminError) {
        printDomainFail(e.message);
      } else {
        printStageFail(STAGE_DOMAIN);
      }
      process.exit(1);
    }

    try {
      if (plan.action === "create") {
        await db.usuario.create({ data: plan.fields });
        console.log(
          "ensure:test-admin: ADMIN de prueba preparado (creado). Usa /login.",
        );
        return;
      }

      assertEnsureUpdateFieldsSafe(plan.fields);
      await db.usuario.update({
        where: { id: plan.userId },
        data: plan.fields,
      });
      console.log(
        "ensure:test-admin: ADMIN de prueba preparado (actualizado). Usa /login.",
      );
    } catch (e) {
      if (e instanceof EnsureTestAdminError) {
        printDomainFail(e.message);
      } else {
        printStageFail(STAGE_WRITE_USER);
      }
      process.exit(1);
    }
  } finally {
    if (db) {
      await db.$disconnect();
    }
  }
}

main().catch(() => {
  printUnexpected();
  process.exit(1);
});
