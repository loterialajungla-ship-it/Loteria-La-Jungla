export class UserDomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "UserDomainError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class UserValidationError extends UserDomainError {
  constructor(message: string, code = "USER_VALIDATION") {
    super(code, message, 400);
    this.name = "UserValidationError";
  }
}

export class UserNotFoundError extends UserDomainError {
  constructor(message = "Usuario no encontrado.") {
    super("USER_NOT_FOUND", message, 404);
    this.name = "UserNotFoundError";
  }
}

export class UserConflictError extends UserDomainError {
  constructor(
    message = "El nombre de usuario ya está en uso.",
    code = "USER_CONFLICT",
  ) {
    super(code, message, 409);
    this.name = "UserConflictError";
  }
}
