/**
 * Errores de dominio del sistema de créditos de vendedores.
 */

export class CreditoDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreditoDomainError";
    this.code = code;
  }
}

export class CreditoValidationError extends CreditoDomainError {
  constructor(message: string, code = "CREDITO_VALIDATION") {
    super(code, message);
    this.name = "CreditoValidationError";
  }
}

export class InsufficientCreditoSaldoError extends CreditoDomainError {
  constructor(message = "Saldo de créditos insuficiente.") {
    super("INSUFFICIENT_CREDITO_SALDO", message);
    this.name = "InsufficientCreditoSaldoError";
  }
}

export class CreditoIdempotencyConflictError extends CreditoDomainError {
  constructor(
    message = "Esta operación de créditos ya fue utilizada con otros datos.",
    code = "CREDITO_IDEMPOTENCY_CONFLICT",
  ) {
    super(code, message);
    this.name = "CreditoIdempotencyConflictError";
  }
}

export class CreditoDuplicateTicketMovimientoError extends CreditoDomainError {
  constructor(tipo: string) {
    super(
      "CREDITO_DUPLICATE_TICKET_MOVIMIENTO",
      `Ya existe un movimiento ${tipo} para este ticket.`,
    );
    this.name = "CreditoDuplicateTicketMovimientoError";
  }
}

export class CreditoConfigError extends CreditoDomainError {
  constructor(message: string, code = "CREDITO_CONFIG") {
    super(code, message);
    this.name = "CreditoConfigError";
  }
}

export class CreditoVendedorRequeridoError extends CreditoDomainError {
  constructor(
    message = "No se puede operar créditos sin un vendedor identificable.",
  ) {
    super("CREDITO_VENDEDOR_REQUERIDO", message);
    this.name = "CreditoVendedorRequeridoError";
  }
}

/**
 * Esquema de créditos ausente o ilegible (migración pendiente / infra).
 * No es saldo insuficiente: la operación debe abortar (fail-closed).
 */
export class CreditosSchemaUnavailableError extends CreditoDomainError {
  constructor(
    message = "El esquema de créditos no está disponible. No se puede completar la operación.",
  ) {
    super("CREDITOS_SCHEMA_UNAVAILABLE", message);
    this.name = "CreditosSchemaUnavailableError";
  }
}

/**
 * Fila CreditosConfig id=1 inexistente (defaults virtuales).
 * Distinto de control desactivado de forma explícita y persistida.
 */
export class CreditosConfigIncompleteError extends CreditoDomainError {
  constructor(
    message = "La configuración de créditos no está inicializada. No se puede completar la operación de venta.",
  ) {
    super("CREDITOS_CONFIG_INCOMPLETE", message);
    this.name = "CreditosConfigIncompleteError";
  }
}
