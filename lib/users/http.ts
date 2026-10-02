import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/errors";
import { PasswordValidationError } from "@/lib/auth/password";
import { UserDomainError } from "@/lib/users/errors";

export function jsonUserError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.httpStatus },
    );
  }
  if (error instanceof UserDomainError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.httpStatus },
    );
  }
  if (error instanceof PasswordValidationError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: error.code, message: error.message },
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
    },
    { status: 500 },
  );
}
