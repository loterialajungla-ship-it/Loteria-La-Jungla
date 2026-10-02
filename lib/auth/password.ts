import bcrypt from "bcryptjs";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";

const BCRYPT_ROUNDS = 12;

export class PasswordValidationError extends Error {
  readonly code = "INVALID_PASSWORD";

  constructor(message: string) {
    super(message);
    this.name = "PasswordValidationError";
  }
}

/** Política mínima: ≥ 8 caracteres. No loguear el valor. */
export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordValidationError(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!password || !passwordHash) return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}
