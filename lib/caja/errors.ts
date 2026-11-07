export class CajaError extends Error {
  readonly code: string;

  constructor(message: string, code = "CAJA_ERROR") {
    super(message);
    this.name = "CajaError";
    this.code = code;
  }
}

export class CajaValidationError extends CajaError {
  constructor(message: string, code = "CAJA_VALIDATION") {
    super(message, code);
    this.name = "CajaValidationError";
  }
}

export class CajaNotFoundError extends CajaError {
  constructor(message = "Recurso de caja no encontrado.", code = "CAJA_NOT_FOUND") {
    super(message, code);
    this.name = "CajaNotFoundError";
  }
}

export class CajaForbiddenError extends CajaError {
  constructor(message = "Operación de caja no permitida.", code = "CAJA_FORBIDDEN") {
    super(message, code);
    this.name = "CajaForbiddenError";
  }
}

export class CajaIdempotencyConflictError extends CajaError {
  constructor(
    message = "Esta operación de Caja ya fue utilizada con otros datos.",
    code = "CAJA_IDEMPOTENCY_CONFLICT",
  ) {
    super(message, code);
    this.name = "CajaIdempotencyConflictError";
  }
}
