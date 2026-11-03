/**
 * Conexión directa para escrituras de producción con `$transaction` interactiva.
 *
 * Tras `assertProduction*Target` (DATABASE_URL + DIRECT_URL = endpoint PRODUCTION
 * allowlisted), Prisma debe usar `DIRECT_URL`: el pooler de Neon no soporta bien
 * transacciones interactivas (`Transaction not found`).
 *
 * Nunca registra ni imprime la URL.
 */

export function requireProductionDirectUrlForInteractiveTx(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  abortPrefix: string,
): string {
  const directUrl = env.DIRECT_URL?.trim() ?? "";
  if (!directUrl) {
    throw new Error(`${abortPrefix}: falta DIRECT_URL.`);
  }
  return directUrl;
}
