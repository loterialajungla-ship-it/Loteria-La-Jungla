import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/errors";

export function jsonAuthError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: error.code, message: error.message },
      },
      { status: error.httpStatus },
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
