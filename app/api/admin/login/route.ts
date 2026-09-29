import { NextResponse } from "next/server";
import {
  COOKIE_ADMIN_SESSION,
  adminPassword,
  adminSessionSecret,
} from "@/lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const secreto = adminSessionSecret();
  const esperado = adminPassword();

  if (!esperado || !secreto || password !== esperado) {
    return NextResponse.redirect(
      new URL("/admin/login?error=1", request.url),
      { status: 303 },
    );
  }

  const response = NextResponse.redirect(new URL("/admin", request.url), {
    status: 303,
  });

  response.cookies.set(COOKIE_ADMIN_SESSION, secreto, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
