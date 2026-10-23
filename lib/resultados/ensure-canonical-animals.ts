/**
 * Preparación del catálogo Animal desde la fuente canónica única.
 * Usada por `scripts/seed-manual-test.ts` (no duplicar listas de animales).
 */
import {
  ANIMALES_CANONICOS,
  CATALOGO_ANIMALITOS_ESPERADO,
} from "@/lib/resultados/catalogo-animalitos-canonico";

/** Ruta de imagen convencional (misma convención que `prisma/seed.ts`). */
export function animalImagenPath(numero: string): string {
  return `/animals/${numero}.png`;
}

export type CanonicalAnimalUpsertDb = {
  animal: {
    upsert: (args: {
      where: { numero: string };
      update: { nombre: string; imagen: string };
      create: { numero: string; nombre: string; imagen: string };
    }) => Promise<unknown>;
  };
};

/**
 * Upsert de los 38 animales canónicos (número, nombre e imagen derivados).
 * No escribe Resultado, Ticket, Usuario, ConfigNegocio ni Auditoria.
 */
export async function upsertCanonicalAnimals(
  db: CanonicalAnimalUpsertDb,
): Promise<{ count: number }> {
  for (const animal of ANIMALES_CANONICOS) {
    const imagen = animalImagenPath(animal.numero);
    await db.animal.upsert({
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
  return { count: CATALOGO_ANIMALITOS_ESPERADO };
}
