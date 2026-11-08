import { NextResponse } from "next/server";

/**
 * Defensa CSRF explícita (B5.6-D) para mutaciones same-origin.
 *
 * Complementa `lj_session` HttpOnly + SameSite=Lax.
 * No usa Host / X-Forwarded-Host / X-Forwarded-For del cliente como allowlist:
 * el origen esperado es únicamente `new URL(request.url).origin`.
 *
 * No aplica a GET/HEAD/OPTIONS. El cron con CRON_SECRET no debe usar este helper.
 */

export const CSRF_ERROR_CODE = "CSRF_ORIGIN_REJECTED" as const;

export type CsrfRejectReason =
  | "missing"
  | "malformed"
  | "mismatch"
  | "unsafe_null"
  | "cross_site_fetch"
  | "bad_request_url";

export type CsrfDecision =
  | { ok: true; matched: "origin" | "referer" }
  | { ok: false; reason: CsrfRejectReason };

const MUTATION = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Cabeceras mínimas para mocks/tests (no exige Headers completo). */
export type CsrfHeaderReader = {
  get(name: string): string | null;
};

export type CsrfRequestLike = {
  method: string;
  url: string;
  headers: CsrfHeaderReader;
};

export function isMutationHttpMethod(method: string): boolean {
  return MUTATION.has(method.toUpperCase());
}

/** Origen canónico del request URL (sin cabeceras de borde). */
export function expectedOriginFromRequestUrl(requestUrl: string): string | null {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Parsea un valor de Origin (p. ej. `https://app.example:443`).
 * Rechaza vacío y el token literal `null` (contexto opaco).
 */
export function parseBrowserOrigin(value: string | null | undefined): {
  kind: "absent" | "null_literal" | "malformed" | "ok";
  origin?: string;
} {
  if (value == null) return { kind: "absent" };
  const raw = value.trim();
  if (!raw) return { kind: "absent" };
  if (raw.toLowerCase() === "null") return { kind: "null_literal" };
  try {
    // Origin es esquema+host+puerto; rechazar si trae path/query/hash.
    const u = new URL(raw);
    if (u.username || u.password) return { kind: "malformed" };
    if ((u.pathname && u.pathname !== "/") || u.search || u.hash) {
      return { kind: "malformed" };
    }
    const origin = u.origin;
    if (!origin || origin === "null") return { kind: "malformed" };
    return { kind: "ok", origin };
  } catch {
    return { kind: "malformed" };
  }
}

export function originFromRefererHeader(
  referer: string | null | undefined,
): { kind: "absent" | "malformed" | "ok"; origin?: string } {
  if (referer == null || !referer.trim()) return { kind: "absent" };
  try {
    return { kind: "ok", origin: new URL(referer.trim()).origin };
  } catch {
    return { kind: "malformed" };
  }
}

/**
 * Valida que una mutación sea same-origin respecto a `request.url`.
 * Métodos seguros → ok (no-op) para facilitar tests.
 */
export function assertMutationSameOrigin(
  request: CsrfRequestLike,
): CsrfDecision {
  if (!isMutationHttpMethod(request.method)) {
    return { ok: true, matched: "origin" };
  }

  const expected = expectedOriginFromRequestUrl(request.url);
  if (!expected) {
    return { ok: false, reason: "bad_request_url" };
  }

  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "cross_site_fetch" };
  }

  const originHeader = request.headers.get("origin");
  const parsedOrigin = parseBrowserOrigin(originHeader);
  if (parsedOrigin.kind === "null_literal") {
    return { ok: false, reason: "unsafe_null" };
  }
  if (parsedOrigin.kind === "malformed") {
    return { ok: false, reason: "malformed" };
  }
  if (parsedOrigin.kind === "ok") {
    if (parsedOrigin.origin !== expected) {
      return { ok: false, reason: "mismatch" };
    }
    return { ok: true, matched: "origin" };
  }

  // Origin ausente → Referer (mismo origen estricto).
  const ref = originFromRefererHeader(request.headers.get("referer"));
  if (ref.kind === "malformed") {
    return { ok: false, reason: "malformed" };
  }
  if (ref.kind === "ok") {
    if (ref.origin !== expected) {
      return { ok: false, reason: "mismatch" };
    }
    return { ok: true, matched: "referer" };
  }

  return { ok: false, reason: "missing" };
}

export function csrfForbiddenBody(reason?: CsrfRejectReason): {
  ok: false;
  error: { code: typeof CSRF_ERROR_CODE; message: string; reason?: CsrfRejectReason };
} {
  return {
    ok: false,
    error: {
      code: CSRF_ERROR_CODE,
      message: "Solicitud rechazada por origen no permitido.",
      ...(reason ? { reason } : {}),
    },
  };
}

export function csrfForbiddenResponse(reason?: CsrfRejectReason): NextResponse {
  return NextResponse.json(csrfForbiddenBody(reason), {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Si la mutación falla el chequeo CSRF, devuelve 403; si no, `null`.
 * Usar al inicio de handlers POST/PUT/PATCH/DELETE (excepto cron).
 */
export function rejectCrossOriginMutation(
  request: CsrfRequestLike,
): NextResponse | null {
  const decision = assertMutationSameOrigin(request);
  if (decision.ok) return null;
  return csrfForbiddenResponse(decision.reason);
}
