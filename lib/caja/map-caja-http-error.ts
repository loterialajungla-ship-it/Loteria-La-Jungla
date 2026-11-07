import {
  CajaError,
  CajaForbiddenError,
  CajaIdempotencyConflictError,
  CajaNotFoundError,
  CajaValidationError,
} from "@/lib/caja/errors";
import { TicketValidationError } from "@/lib/tickets/errors";

export type CajaHttpErrorBody = {
  ok: false;
  error: { code: string; message: string };
};

function jsonError(
  status: number,
  code: string,
  message: string,
): { status: number; body: CajaHttpErrorBody } {
  return {
    status,
    body: { ok: false, error: { code, message } },
  };
}

export function mapCajaErrorToHttp(error: unknown): {
  status: number;
  body: CajaHttpErrorBody;
} {
  if (error instanceof CajaIdempotencyConflictError) {
    return jsonError(409, error.code, error.message);
  }
  if (error instanceof CajaForbiddenError) {
    return jsonError(403, error.code, error.message);
  }
  if (error instanceof CajaNotFoundError) {
    return jsonError(404, error.code, error.message);
  }
  if (error instanceof CajaValidationError) {
    return jsonError(400, error.code, error.message);
  }
  if (error instanceof TicketValidationError) {
    return jsonError(400, error.code, error.message);
  }
  if (error instanceof CajaError) {
    return jsonError(400, error.code, error.message);
  }
  return jsonError(500, "INTERNAL_ERROR", "Error interno del servidor.");
}
