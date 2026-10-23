/**
 * Seed de catálogo (animales + multiplicador).
 *
 * Política cerrada (PROMPT 094): no se ejecuta contra producción, recovery
 * ni desarrollo recuperado de forma implícita.
 *
 * Autorización explícita (única permitida hoy):
 *   PRISMA_SEED_TARGET=test
 *   DATABASE_URL / DIRECT_URL → endpoint TEST ep-muddy-fire-b44816w0
 *
 * Los runners de integración/acceptance NO invocan este archivo; usan
 * seedMinimalBusiness / seed-manual-test con sus propios guards.
 */

import { PrismaClient } from "@prisma/client";
import { assertPrismaSeedAllowed } from "../lib/db/neon-endpoint-guard";
import { ANIMALES_CANONICOS } from "../lib/resultados/catalogo-animalitos-canonico";

const ANIMALES = ANIMALES_CANONICOS;

async function main() {
  const endpointId = assertPrismaSeedAllowed(process.env);
  console.log(`→ prisma seed autorizado (endpoint=${endpointId})`);

  const prisma = new PrismaClient();
  try {
    for (const animal of ANIMALES) {
      const imagen = `/animals/${animal.numero}.png`;

      await prisma.animal.upsert({
        where: { numero: animal.numero },
        update: {
          nombre: animal.nombre,
          imagen,
        },
        create: {
          numero: animal.numero,
          nombre: animal.nombre,
          imagen,
        },
      });
    }

    console.log(`Seed completado: ${ANIMALES.length} animalitos.`);

    await prisma.configNegocio.upsert({
      where: { clave: "MULTIPLICADOR_PREMIO" },
      update: { valorInt: 30 },
      create: {
        clave: "MULTIPLICADOR_PREMIO",
        valorInt: 30,
      },
    });

    console.log("ConfigNegocio: MULTIPLICADOR_PREMIO = 30");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
