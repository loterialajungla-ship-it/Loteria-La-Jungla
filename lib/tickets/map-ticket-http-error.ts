import { Prisma } from "@prisma/client";
import {
  ConfigurationError,
  IdempotencyConflictError,
  TicketAlreadyAnuladoError,
  TicketDomainError,
  TicketNotFoundError,
  TicketValidationError,
} from "@/lib/tickets/errors";

export type HttpErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export function jsonError(
  status: number,
  code: string,
  message: string,
): { status: number; body: HttpErrorBody } {
  return {
    status,
    body: {
      ok: false,
      error: { code, message },
    },
  };
}

/**
 * Mapea errores de dominio / Prisma a HTTP.
 * No expone mensajes internos de Prisma ni stack traces.
 */
export function mapTicketErrorToHttp(error: unknown): {
  status: number;
  body: HttpErrorBody;
} {
  if (error instanceof TicketNotFoundError) {
    return jsonError(404, error.code, error.message);
  }

  if (error instanceof TicketAlreadyAnuladoError) {
    return jsonError(409, error.code, error.message);
  }

  if (error instanceof IdempotencyConflictError) {
    return jsonError(409, error.code, error.message);
  }

  if (error instanceof TicketValidationError) {
    return jsonError(400, error.code, error.message);
  }

  if (error instanceof ConfigurationError) {
    return jsonError(500, error.code, "Error de configuración del servidor.");
  }

  if (error instanceof TicketDomainError) {
    return jsonError(400, error.code, error.message);
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return jsonError(
      409,
      "CONFLICT",
      "Conflicto de unicidad al crear el ticket. Reintente.",
    );
  }

  return jsonError(500, "INTERNAL_ERROR", "Error interno del servidor.");
}
