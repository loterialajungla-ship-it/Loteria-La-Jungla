import type { CreateTicketInput } from "@/lib/tickets/types";
import { TicketValidationError } from "@/lib/tickets/errors";
import { validarIdempotencyKey } from "@/lib/tickets/idempotency";

/**
 * Validación mínima de forma del JSON antes de llamar a createTicket.
 * La validación de dominio (fecha, horas, importes, animales) vive en lib/tickets.
 */
export function parseCreateTicketBody(raw: unknown): CreateTicketInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TicketValidationError(
      "El body debe ser un objeto JSON.",
      "INVALID_BODY",
    );
  }

  const body = raw as Record<string, unknown>;

  // Campos que el cliente NO puede imponer (se generan en servidor).
  const prohibidos = [
    "totalApostado",
    "multiplicador",
    "multiplicadorUsado",
    "premio",
    "exposicion",
    "estado",
    "numeroVisible",
    "codigoPublico",
    "id",
    "idempotencyRequestHash",
  ] as const;
  for (const campo of prohibidos) {
    if (campo in body) {
      throw new TicketValidationError(
        `Campo no permitido en la creación: ${campo}.`,
        "FORBIDDEN_FIELD",
      );
    }
  }

  if (typeof body.fechaJuego !== "string" || !body.fechaJuego.trim()) {
    throw new TicketValidationError(
      "fechaJuego es requerida (YYYY-MM-DD).",
      "INVALID_BODY",
    );
  }

  if (
    body.vendedorId !== undefined &&
    body.vendedorId !== null &&
    typeof body.vendedorId !== "string"
  ) {
    throw new TicketValidationError(
      "vendedorId debe ser string o null.",
      "INVALID_BODY",
    );
  }

  const idempotencyKey = validarIdempotencyKey(body.idempotencyKey);

  if (!Array.isArray(body.lineas)) {
    throw new TicketValidationError(
      "lineas debe ser un arreglo.",
      "INVALID_BODY",
    );
  }

  const lineas = body.lineas.map((linea, index) => {
    if (linea === null || typeof linea !== "object" || Array.isArray(linea)) {
      throw new TicketValidationError(
        `lineas[${index}] debe ser un objeto.`,
        "INVALID_BODY",
      );
    }
    const l = linea as Record<string, unknown>;
    if (typeof l.hora !== "number") {
      throw new TicketValidationError(
        `lineas[${index}].hora debe ser number.`,
        "INVALID_BODY",
      );
    }
    if (typeof l.numeroAnimal !== "string") {
      throw new TicketValidationError(
        `lineas[${index}].numeroAnimal debe ser string.`,
        "INVALID_BODY",
      );
    }
    if (typeof l.importe !== "string" && typeof l.importe !== "number") {
      throw new TicketValidationError(
        `lineas[${index}].importe debe ser string o number.`,
        "INVALID_BODY",
      );
    }
    return {
      hora: l.hora,
      numeroAnimal: l.numeroAnimal,
      importe: l.importe as string | number,
    };
  });

  return {
    fechaJuego: body.fechaJuego.trim(),
    // vendedorId del cliente se IGNORA; la API asigna el usuario autenticado.
    vendedorId: null,
    idempotencyKey,
    lineas,
  };
}
