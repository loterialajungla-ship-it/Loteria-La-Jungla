/**
 * Reparación controlada de Animal.nombre — SOLO Neon TEST.
 *
 * Uso (opt-in dual; NUNCA contra Production):
 *   ANIMAL_NAMES_REPAIR_TARGET=test
 *   CONFIRM_TEST_ANIMAL_NAMES_REPAIR=I_UNDERSTAND_THIS_REPAIRS_TEST_ANIMAL_NAMES
 *   TEST_DATABASE_URL → endpoint TEST ep-muddy-fire-b44816w0
 *   npm run repair-animal-names:test
 *
 * - Solo allowlist explícita (p. ej. 20: Cochino → Cerdo).
 * - Solo actualiza Animal.nombre; no create/delete/upsert; no toca imagen.
 * - No acepta argumentos CLI.
 * - No imprime URLs ni secretos.
 * - No reutiliza ni debilita repair-animal-names:production.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  NEON_ENDPOINTS,
  TEST_ANIMAL_NAMES_REPAIR_TARGET,
  assertTestAnimalNamesRepairTarget,
} from "../lib/db/neon-endpoint-guard";
import {
  RepairAnimalNamesTestError,
  TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
  runRepairAnimalNamesTest,
} from "../lib/dev/repair-animal-names-test";
import { assertSafeTestDatabase } from "../lib/tickets/integration/safe-test-db";

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

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "repair-animal-names:test no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  loadEnvFile(path.join(ROOT, ".env"));

  let testUrl: string;
  try {
    testUrl = assertSafeTestDatabase(process.env);
  } catch (e) {
    console.error(
      e instanceof Error
        ? e.message
        : "Reparación de nombres Animal de TEST abortada: TEST_DATABASE_URL no es el endpoint TEST autorizado aislado.",
    );
    process.exit(1);
  }

  // Inyectar destino de escritura = TEST (no muta el .env en disco).
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = testUrl;

  let endpointId: string;
  try {
    endpointId = assertTestAnimalNamesRepairTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (endpointId !== NEON_ENDPOINTS.TEST) {
    console.error(
      "Reparación de nombres Animal de TEST abortada: el endpoint de escritura no es el TEST autorizado.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });
  try {
    const result = await runRepairAnimalNamesTest(
      prisma as unknown as Parameters<typeof runRepairAnimalNamesTest>[0],
      TEST_ANIMAL_NAME_REPAIRS_ALLOWED,
    );
    if (result.status === "already_applied") {
      console.log(
        `Catálogo Animal TEST ya alineado para la allowlist (updated=0 skipped=${result.skippedAlreadyCanonical}) endpoint=${endpointId} target=${TEST_ANIMAL_NAMES_REPAIR_TARGET}. Retira ANIMAL_NAMES_REPAIR_TARGET y CONFIRM_TEST_ANIMAL_NAMES_REPAIR.`,
      );
      return;
    }
    console.log(
      `Nombres Animal TEST reparados: updated=${result.updated} skipped=${result.skippedAlreadyCanonical} endpoint=${endpointId} target=${TEST_ANIMAL_NAMES_REPAIR_TARGET}. Retira ANIMAL_NAMES_REPAIR_TARGET y CONFIRM_TEST_ANIMAL_NAMES_REPAIR.`,
    );
  } catch (e) {
    if (e instanceof RepairAnimalNamesTestError) {
      console.error(e.message);
    } else {
      console.error("Reparación de nombres Animal de TEST falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Reparación de nombres Animal de TEST falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
