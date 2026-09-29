import { NextResponse } from "next/server";
import { COOKIE_ADMIN_SESSION } from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(
    new URL("/admin/login", request.url),
    { status: 303 },
  );

  response.cookies.set(COOKIE_ADMIN_SESSION, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
