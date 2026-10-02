export class TicketDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TicketDomainError";
    this.code = code;
  }
}

export class TicketValidationError extends TicketDomainError {
  constructor(message: string, code = "TICKET_VALIDATION") {
    super(code, message);
    this.name = "TicketValidationError";
  }
}

export class InvalidGameDateError extends TicketValidationError {
  constructor(message = "La fecha de juego debe ser hoy (America/Caracas).") {
    super(message, "INVALID_GAME_DATE");
    this.name = "InvalidGameDateError";
  }
}

export class InvalidDrawHourError extends TicketValidationError {
  constructor(hora: number) {
    super(`Hora de sorteo no válida: ${hora}.`, "INVALID_DRAW_HOUR");
    this.name = "InvalidDrawHourError";
  }
}

export class InvalidBetAmountError extends TicketValidationError {
  constructor(message = "Importe de apuesta no válido.") {
    super(message, "INVALID_BET_AMOUNT");
    this.name = "InvalidBetAmountError";
  }
}

export class DuplicateTicketLineError extends TicketValidationError {
  constructor(hora: number, numeroAnimal: string) {
    super(
      `Línea duplicada: hora ${hora} y animal ${numeroAnimal}.`,
      "DUPLICATE_TICKET_LINE",
    );
    this.name = "DuplicateTicketLineError";
  }
}

export class EmptyTicketLinesError extends TicketValidationError {
  constructor() {
    super("El ticket debe tener al menos una línea.", "EMPTY_TICKET_LINES");
    this.name = "EmptyTicketLinesError";
  }
}

export class AnimalNotFoundError extends TicketValidationError {
  constructor(numeros: string[]) {
    super(
      `Animal(es) no encontrado(s): ${numeros.join(", ")}.`,
      "ANIMAL_NOT_FOUND",
    );
    this.name = "AnimalNotFoundError";
  }
}

export class ConfigurationError extends TicketDomainError {
  constructor(message: string) {
    super("CONFIGURATION_ERROR", message);
    this.name = "ConfigurationError";
  }
}

export class DrawClosedError extends TicketValidationError {
  readonly hora: number;

  constructor(hora: number) {
    const label = `${String(hora).padStart(2, "0")}:00`;
    super(
      `El sorteo de las ${label} ya está cerrado para ventas.`,
      "DRAW_CLOSED",
    );
    this.name = "DrawClosedError";
    this.hora = hora;
  }
}

export class TicketNotFoundError extends TicketDomainError {
  constructor(message = "Ticket no encontrado.") {
    super("TICKET_NOT_FOUND", message);
    this.name = "TicketNotFoundError";
  }
}

export class TicketAlreadyAnuladoError extends TicketDomainError {
  constructor(message = "El ticket ya está anulado.") {
    super("ALREADY_ANULADO", message);
    this.name = "TicketAlreadyAnuladoError";
  }
}

export class InvalidAnulacionMotivoError extends TicketValidationError {
  constructor(
    message = "El motivo de anulación es obligatorio (máx. 500 caracteres).",
  ) {
    super(message, "INVALID_ANULACION_MOTIVO");
    this.name = "InvalidAnulacionMotivoError";
  }
}

/** Misma clave de idempotencia con otro usuario o body distinto. */
export class IdempotencyConflictError extends TicketDomainError {
  constructor(
    message = "Esta operación no puede reutilizarse.",
    code = "IDEMPOTENCY_CONFLICT",
  ) {
    super(code, message);
    this.name = "IdempotencyConflictError";
  }
}
