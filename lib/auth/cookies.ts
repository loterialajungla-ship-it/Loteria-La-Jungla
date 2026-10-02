import type { NextResponse } from "next/server";
import {
  COOKIE_LJ_SESSION,
  isProduction,
  sessionMaxAgeSeconds,
} from "@/lib/auth/constants";

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function ljSessionCookieOptions(
  maxAge = sessionMaxAgeSeconds(),
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge,
  };
}

export function setLjSessionCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set(COOKIE_LJ_SESSION, token, ljSessionCookieOptions());
}

export function clearLjSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_LJ_SESSION, "", {
    ...ljSessionCookieOptions(0),
    maxAge: 0,
  });
}
