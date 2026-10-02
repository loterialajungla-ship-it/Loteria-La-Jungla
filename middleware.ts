/**
 * Gate de rutas UI — solo AUTH NUEVA (`lj_session`).
 *
 * /login → público (formulario único)
 * /admin/login → 308 → /login (compatibilidad)
 * /admin/* → requiere cookie lj_session (rol definitivo en layout/APIs)
 * /venta/* → requiere cookie lj_session
 * /ticket/* → público (fuera del matcher)
 *
 * No acepta admin_session ni ningún fallback legacy.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_LJ_SESSION } from "@/lib/auth/constants";
import { absoluteUrlFromRequest } from "@/lib/http/public-origin";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-lj-pathname", pathname);

  const withPath = {
    request: { headers: requestHeaders },
  };

  // Compat: únicaUI de login es /login
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    const dest = absoluteUrlFromRequest(request, "/login");
    if (request.nextUrl.search) {
      dest.search = request.nextUrl.search;
    }
    return NextResponse.redirect(dest, 308);
  }

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next(withPath);
  }

  const requiereSesion =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/venta") ||
    pathname === "/perfil" ||
    pathname.startsWith("/perfil/");

  if (!requiereSesion) {
    return NextResponse.next(withPath);
  }

  const lj = request.cookies.get(COOKIE_LJ_SESSION)?.value;
  if (!lj) {
    return NextResponse.redirect(absoluteUrlFromRequest(request, "/login"));
  }

  return NextResponse.next(withPath);
}

export const config = {
  matcher: [
    "/login",
    "/login/:path*",
    "/admin",
    "/admin/:path*",
    "/venta",
    "/venta/:path*",
    "/perfil",
    "/perfil/:path*",
  ],
};
