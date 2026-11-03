/**
 * Mapper de presentación para respuestas de POST /api/venta/tickets.
 * Solo usa status HTTP + error.code estructurado. No inventa campos ni
 * clasifica por texto del mensaje. No autoriza ni descuenta saldo.
 */

export const CREATE_TICKET_INSUFFICIENT_TITLE = "Saldo insuficiente.";
export const CREATE_TICKET_INSUFFICIENT_MESSAGE =
  "No hay créditos suficientes para crear este ticket. La operación fue rechazada y no se generó ningún ticket. Revisa tu saldo antes de volver a intentarlo.";

export const CREATE_TICKET_DEFAULT_TITLE = "No se pudo crear el ticket";
export const CREATE_TICKET_CONFLICT_FALLBACK =
  "Se produjo un conflicto al generar el ticket. Inténtalo nuevamente.";
export const CREATE_TICKET_GENERIC_FALLBACK =
  "No se pudo crear el ticket. Revisa los datos e inténtalo nuevamente.";
export const CREATE_TICKET_NETWORK_FALLBACK =
  "No se pudo crear el ticket. Puedes reintentar: no se duplicará la venta.";
export const CREATE_TICKET_UNAUTHORIZED_MESSAGE =
  "Tu sesión ha expirado. Inicia sesión nuevamente.";

export type CreateTicketErrorPayload = {
  code?: string;
  message?: string;
};

export type CreateTicketResponseBody = {
  ok?: boolean;
  ticket?: unknown;
  idempotentReplay?: boolean;
  error?: CreateTicketErrorPayload;
};

export type CreateTicketClientOutcome =
  | {
      kind: "insufficient_credito_saldo";
      title: string;
      message: string;
      clearIdempotencyKey: true;
      refreshSaldo: true;
      refreshHoras: false;
      clearApuestas: false;
      autoRetryPost: false;
    }
  | {
      kind: "conflict";
      title: string;
      message: string;
      clearIdempotencyKey: true;
      refreshSaldo: false;
      refreshHoras: false;
      clearApuestas: false;
      autoRetryPost: false;
    }
  | {
      kind: "unauthorized";
      title: string;
      message: string;
      clearIdempotencyKey: false;
      refreshSaldo: false;
      refreshHoras: false;
      clearApuestas: false;
      autoRetryPost: false;
    }
  | {
      kind: "draw_closed";
      title: string;
      message: string;
      clearIdempotencyKey: false;
      refreshSaldo: false;
      refreshHoras: true;
      clearApuestas: false;
      autoRetryPost: false;
    }
  | {
      kind: "generic_error";
      title: string;
      message: string;
      clearIdempotencyKey: false;
      refreshSaldo: false;
      refreshHoras: false;
      clearApuestas: false;
      autoRetryPost: false;
    }
  | {
      kind: "success";
      clearIdempotencyKey: true;
      refreshSaldo: true;
      refreshHoras: false;
      clearApuestas: true;
      autoRetryPost: false;
    }
  | {
      kind: "network_error";
      title: string;
      message: string;
      clearIdempotencyKey: false;
      refreshSaldo: false;
      refreshHoras: false;
      clearApuestas: false;
      autoRetryPost: false;
    };

function conflictMessage(error: CreateTicketErrorPayload | undefined): string {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return CREATE_TICKET_CONFLICT_FALLBACK;
}

function genericMessage(error: CreateTicketErrorPayload | undefined): string {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return CREATE_TICKET_GENERIC_FALLBACK;
}

function drawClosedMessage(serverMessage: string | undefined): string {
  const horaMatch = /(\d{1,2}):00/.exec(serverMessage ?? "");
  const label = horaMatch
    ? `${horaMatch[1].padStart(2, "0")}:00`
    : "seleccionada";
  return `El sorteo de las ${label} ya cerró. Actualiza las horas disponibles.`;
}

/**
 * Interpreta status + body del POST de creación.
 * No dispara efectos: el caller aplica flags (refreshSaldo, etc.).
 */
export function mapCreateTicketClientResponse(
  status: number,
  body: CreateTicketResponseBody | null | undefined,
): CreateTicketClientOutcome {
  const error = body?.error;

  if (status === 401) {
    return {
      kind: "unauthorized",
      title: CREATE_TICKET_DEFAULT_TITLE,
      message: CREATE_TICKET_UNAUTHORIZED_MESSAGE,
      clearIdempotencyKey: false,
      refreshSaldo: false,
      refreshHoras: false,
      clearApuestas: false,
      autoRetryPost: false,
    };
  }

  if (status === 409) {
    if (error?.code === "INSUFFICIENT_CREDITO_SALDO") {
      return {
        kind: "insufficient_credito_saldo",
        title: CREATE_TICKET_INSUFFICIENT_TITLE,
        message: CREATE_TICKET_INSUFFICIENT_MESSAGE,
        clearIdempotencyKey: true,
        refreshSaldo: true,
        refreshHoras: false,
        clearApuestas: false,
        autoRetryPost: false,
      };
    }

    // IDEMPOTENCY_*, CREDITO_IDEMPOTENCY_CONFLICT, CONFLICT u otros 409:
    // conflicto genérico — nunca copy de saldo insuficiente.
    return {
      kind: "conflict",
      title: CREATE_TICKET_DEFAULT_TITLE,
      message: conflictMessage(error),
      clearIdempotencyKey: true,
      refreshSaldo: false,
      refreshHoras: false,
      clearApuestas: false,
      autoRetryPost: false,
    };
  }

  if (status === 400 && error?.code === "DRAW_CLOSED") {
    return {
      kind: "draw_closed",
      title: CREATE_TICKET_DEFAULT_TITLE,
      message: drawClosedMessage(error.message),
      clearIdempotencyKey: false,
      refreshSaldo: false,
      refreshHoras: true,
      clearApuestas: false,
      autoRetryPost: false,
    };
  }

  if ((status !== 200 && status !== 201) || !body?.ticket) {
    return {
      kind: "generic_error",
      title: CREATE_TICKET_DEFAULT_TITLE,
      message: genericMessage(error),
      clearIdempotencyKey: false,
      refreshSaldo: false,
      refreshHoras: false,
      clearApuestas: false,
      autoRetryPost: false,
    };
  }

  return {
    kind: "success",
    clearIdempotencyKey: true,
    refreshSaldo: true,
    refreshHoras: false,
    clearApuestas: true,
    autoRetryPost: false,
  };
}

export function mapCreateTicketNetworkError(): Extract<
  CreateTicketClientOutcome,
  { kind: "network_error" }
> {
  return {
    kind: "network_error",
    title: CREATE_TICKET_DEFAULT_TITLE,
    message: CREATE_TICKET_NETWORK_FALLBACK,
    clearIdempotencyKey: false,
    refreshSaldo: false,
    refreshHoras: false,
    clearApuestas: false,
    autoRetryPost: false,
  };
}
