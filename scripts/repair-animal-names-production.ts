/**
 * Reparación controlada de Animal.nombre — SOLO producción.
 *
 * Uso (opt-in dual; NUNCA ejecutar sin backup + autorización humana):
 *   ANIMAL_NAMES_REPAIR_TARGET=production
 *   CONFIRM_PRODUCTION_ANIMAL_NAMES_REPAIR=I_UNDERSTAND_THIS_REPAIRS_PRODUCTION_ANIMAL_NAMES
 *   DATABASE_URL / DIRECT_URL → endpoint PRODUCTION
 *   npm run repair-animal-names:production
 *
 * - Solo actualiza Animal.nombre cuando difiere del catálogo canónico.
 * - Exige exactamente los 38 números canónicos; no create/delete/upsert.
 * - No toca imagen, tickets, resultados, usuarios ni auditoría.
 * - No acepta argumentos CLI.
 * - No imprime URLs ni secretos.
 */

import { PrismaClient } from "@prisma/client";
import {
  assertProductionAnimalNamesRepairTarget,
  PRODUCTION_ANIMAL_NAMES_REPAIR_TARGET,
} from "../lib/db/neon-endpoint-guard";
import { requireProductionDirectUrlForInteractiveTx } from "../lib/db/production-direct-url";
import {
  RepairAnimalNamesProductionError,
  runRepairAnimalNamesProduction,
} from "../lib/dev/repair-animal-names-production";

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    console.error(
      "repair-animal-names:production no acepta argumentos. Usa solo variables de entorno.",
    );
    process.exit(1);
  }

  let endpointId: string;
  try {
    endpointId = assertProductionAnimalNamesRepairTarget(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // Neon pooler no soporta bien $transaction interactiva de Prisma.
  // Tras el guard (ambas URLs = PRODUCTION), usar solo DIRECT_URL aquí.
  let directUrl: string;
  try {
    directUrl = requireProductionDirectUrlForInteractiveTx(
      process.env,
      "Reparación de nombres Animal de producción abortada",
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });
  try {
    const result = await runRepairAnimalNamesProduction(
      prisma as unknown as Parameters<typeof runRepairAnimalNamesProduction>[0],
    );
    if (result.status === "already_canonical") {
      console.log(
        `Catálogo Animal ya canónico (updated=0 unchanged=${result.unchanged}) endpoint=${endpointId} target=${PRODUCTION_ANIMAL_NAMES_REPAIR_TARGET}. Retira ANIMAL_NAMES_REPAIR_* y CONFIRM_PRODUCTION_ANIMAL_NAMES_REPAIR.`,
      );
      return;
    }
    console.log(
      `Nombres Animal reparados: updated=${result.updated} unchanged=${result.unchanged} endpoint=${endpointId} target=${PRODUCTION_ANIMAL_NAMES_REPAIR_TARGET}. Verifica /admin. Retira ANIMAL_NAMES_REPAIR_* y CONFIRM_PRODUCTION_ANIMAL_NAMES_REPAIR.`,
    );
  } catch (e) {
    if (e instanceof RepairAnimalNamesProductionError) {
      console.error(e.message);
    } else {
      console.error("Reparación de nombres Animal de producción falló.");
      console.error(e instanceof Error ? e.message : e);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Reparación de nombres Animal de producción falló.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
