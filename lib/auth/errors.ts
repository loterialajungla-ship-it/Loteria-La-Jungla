export class AuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = "No autorizado") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = "Acceso denegado") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class UserValidationError extends AuthError {
  constructor(message: string, code = "USER_VALIDATION") {
    super(code, message, 400);
    this.name = "UserValidationError";
  }
}

export class UserConflictError extends AuthError {
  constructor(message = "El nombre de usuario ya está en uso.") {
    super("USER_CONFLICT", message, 409);
    this.name = "UserConflictError";
  }
}

export class UserNotFoundError extends AuthError {
  constructor(message = "Usuario no encontrado.") {
    super("USER_NOT_FOUND", message, 404);
    this.name = "UserNotFoundError";
  }
}

export class UserStateConflictError extends AuthError {
  constructor(message: string) {
    super("USER_STATE_CONFLICT", message, 409);
    this.name = "UserStateConflictError";
  }
}
