import type { PrismaClient } from "@prisma/client";
import { ConfigurationError } from "@/lib/tickets/errors";

export const CLAVE_MULTIPLICADOR_PREMIO = "MULTIPLICADOR_PREMIO";

type PrismaLike = Pick<PrismaClient, "configNegocio">;

/**
 * Única fuente de verdad del multiplicador de premio (ConfigNegocio).
 * No hardcodear 30 en callers.
 */
export async function getMultiplicadorPremio(
  db: PrismaLike,
): Promise<number> {
  const fila = await db.configNegocio.findUnique({
    where: { clave: CLAVE_MULTIPLICADOR_PREMIO },
  });

  if (!fila) {
    throw new ConfigurationError(
      `Falta configuración ${CLAVE_MULTIPLICADOR_PREMIO}.`,
    );
  }

  if (!Number.isInteger(fila.valorInt) || fila.valorInt <= 0) {
    throw new ConfigurationError(
      `${CLAVE_MULTIPLICADOR_PREMIO} debe ser un entero mayor que 0.`,
    );
  }

  return fila.valorInt;
}
