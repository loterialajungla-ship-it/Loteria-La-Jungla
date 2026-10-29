import { Prisma } from "@prisma/client";
import { CreditosSchemaUnavailableError } from "@/lib/creditos/errors";

/**
 * Detecta ausencia del esquema de créditos (migración aún no aplicada
 * o tablas/relaciones de créditos inexistentes).
 *
 * No autoriza omitir el control: quien detecte este caso debe fallar
 * de forma explícita (fail-closed) vía `rethrowCreditosSchemaOrPropagate`.
 */
export function isCreditosSchemaMissing(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === "P2021") return true;
  const msg = `${error.message}\n${JSON.stringify(error.meta ?? {})}`;
  return (
    /VendedorCreditoCuenta|CreditoMovimiento|CreditosConfig/i.test(msg) &&
    /does not exist|n'existe|existiert nicht/i.test(msg)
  );
}

/**
 * Si el error indica esquema ausente → CreditosSchemaUnavailableError.
 * Cualquier otro error se re-lanza sin transformar (p. ej. saldo insuficiente).
 */
export function rethrowCreditosSchemaOrPropagate(error: unknown): never {
  if (isCreditosSchemaMissing(error)) {
    throw new CreditosSchemaUnavailableError();
  }
  throw error;
}
