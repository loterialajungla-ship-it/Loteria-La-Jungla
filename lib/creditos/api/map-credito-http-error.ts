/**
 * Mapeo HTTP de errores de créditos (API admin / mi-cuenta).
 * No expone SQL, stacks ni secretos.
 */
import {
  CreditoDomainError,
  CreditoIdempotencyConflictError,
  CreditoValidationError,
  CreditoConfigError,
  CreditosConfigIncompleteError,
  CreditosSchemaUnavailableError,
  InsufficientCreditoSaldoError,
} from "@/lib/creditos/errors";
import {
  jsonError,
  type HttpErrorBody,
} from "@/lib/tickets/map-ticket-http-error";

export function mapCreditoErrorToHttp(error: unknown): {
  status: number;
  body: HttpErrorBody;
} {
  if (error instanceof InsufficientCreditoSaldoError) {
    return jsonError(409, error.code, error.message);
  }

  if (error instanceof CreditoIdempotencyConflictError) {
    return jsonError(409, error.code, error.message);
  }

  if (error instanceof CreditosSchemaUnavailableError) {
    return jsonError(503, error.code, error.message);
  }

  if (error instanceof CreditosConfigIncompleteError) {
    return jsonError(503, error.code, error.message);
  }

  if (error instanceof CreditoConfigError) {
    return jsonError(400, error.code, error.message);
  }

  if (error instanceof CreditoValidationError) {
    const status =
      error.code === "CREDITO_VENDEDOR_NO_ENCONTRADO" ||
      error.code === "CREDITO_ORIGEN_NO_ENCONTRADO"
        ? 404
        : 400;
    return jsonError(status, error.code, error.message);
  }

  if (error instanceof CreditoDomainError) {
    return jsonError(400, error.code, error.message);
  }

  return jsonError(500, "INTERNAL_ERROR", "Error interno del servidor.");
}
