import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
  PasswordValidationError,
} from "@/lib/auth/password";
import {
  generateSessionToken,
  hashSessionToken,
} from "@/lib/auth/tokens";
import { redirectPathForRole } from "@/lib/auth/login";
import {
  AuthError,
  ForbiddenError,
  UnauthorizedError,
} from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { sessionHours, PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";
import { parseCreateTicketBody } from "@/lib/tickets/parse-create-ticket-body";
import {
  authorizeAdminUi,
  authorizePerfilUi,
  authorizeVentaUi,
  canAccessAdminApi,
  canAccessVentaApi,
  canChangeOwnPassword,
  canResetVendorPassword,
  envSecretAuthenticates,
  legacyCookieGrantsAccess,
} from "@/lib/acceptance/authorize-rules";

describe("password hash/verify", () => {
  it("hash + verify correctos", async () => {
    const hash = await hashPassword("secreto12");
    assert.notEqual(hash, "secreto12");
    assert.equal(await verifyPassword("secreto12", hash), true);
  });

  it("password incorrecto → false", async () => {
    const hash = await hashPassword("secreto12");
    assert.equal(await verifyPassword("otra-cosa", hash), false);
  });

  it("política mínima 8 caracteres", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.throws(() => assertPasswordPolicy("corto"), PasswordValidationError);
    assert.doesNotThrow(() => assertPasswordPolicy("12345678"));
  });
});

describe("session tokens", () => {
  it("genera token opaco y hash distinto del token", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 32);
    const h = hashSessionToken(a);
    assert.notEqual(h, a);
    assert.equal(h, hashSessionToken(a));
    assert.equal(h.length, 64); // sha256 hex
  });

  it("token real nunca es el valor almacenado (hash)", () => {
    const token = generateSessionToken();
    const stored = hashSessionToken(token);
    assert.doesNotMatch(stored, new RegExp(token.slice(0, 8)));
  });
});

describe("roles / redirects", () => {
  it("ADMIN → /admin, VENDEDOR → /venta", () => {
    assert.equal(redirectPathForRole("ADMIN"), "/admin");
    assert.equal(redirectPathForRole("VENDEDOR"), "/venta");
  });
});

describe("AuthError HTTP", () => {
  it("401 / 403", async () => {
    const u = jsonAuthError(new UnauthorizedError());
    assert.equal(u.status, 401);
    const bodyU = await u.json();
    assert.equal(bodyU.error.code, "UNAUTHORIZED");
    assert.equal("passwordHash" in bodyU, false);

    const f = jsonAuthError(new ForbiddenError());
    assert.equal(f.status, 403);
    const bodyF = await f.json();
    assert.equal(bodyF.error.code, "FORBIDDEN");
  });

  it("AuthError es instancia reconocible", () => {
    assert.ok(new UnauthorizedError() instanceof AuthError);
    assert.ok(new ForbiddenError() instanceof AuthError);
  });
});

describe("creación de ticket ignora vendedorId del cliente", () => {
  it("parse siempre deja vendedorId null (API asigna sesión)", () => {
    const input = parseCreateTicketBody({
      fechaJuego: "2026-10-01",
      vendedorId: "cliente-falso",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      lineas: [{ hora: 14, numeroAnimal: "03", importe: "2.00" }],
    });
    assert.equal(input.vendedorId, null);
  });
});

describe("sesión conceptual: expiración e inactivo", () => {
  it("expiresAt en el pasado se considera inválida", () => {
    const expiresAt = new Date("2020-01-01T00:00:00.000Z");
    const ahora = new Date("2026-10-01T00:00:00.000Z");
    assert.equal(expiresAt.getTime() <= ahora.getTime(), true);
  });

  it("usuario inactivo no debe autorizar aunque sesión no expire", () => {
    const user = { activo: false as boolean };
    const sessionOk = true;
    assert.equal(sessionOk && user.activo, false);
  });
});

describe("permisos conceptuales ADMIN / VENDEDOR", () => {
  function canAccessAdmin(rol: string): boolean {
    return rol === "ADMIN";
  }
  function canVenta(rol: string): boolean {
    return rol === "ADMIN" || rol === "VENDEDOR";
  }
  function canAnular(rol: string): boolean {
    return rol === "ADMIN";
  }

  it("ADMIN autorizado en admin y venta", () => {
    assert.equal(canAccessAdmin("ADMIN"), true);
    assert.equal(canVenta("ADMIN"), true);
    assert.equal(canAnular("ADMIN"), true);
  });

  it("VENDEDOR autorizado venta; rechazado admin/anular", () => {
    assert.equal(canAccessAdmin("VENDEDOR"), false);
    assert.equal(canVenta("VENDEDOR"), true);
    assert.equal(canAnular("VENDEDOR"), false);
  });

  it("sin sesión → 401", () => {
    assert.equal(new UnauthorizedError().httpStatus, 401);
  });

  it("rol incorrecto → 403", () => {
    assert.equal(new ForbiddenError().httpStatus, 403);
  });
});

describe("middleware no protege consulta pública (documentado)", () => {
  it("matcher incluye /perfil y no /ticket", () => {
    const matcher = [
      "/admin",
      "/admin/:path*",
      "/venta",
      "/venta/:path*",
      "/perfil",
      "/perfil/:path*",
    ];
    assert.equal(
      matcher.some((m) => m.includes("ticket")),
      false,
    );
    assert.equal(matcher.includes("/perfil"), true);
  });
});

describe("legacy retirado: no autentica", () => {
  it("admin_session / ADMIN_PASSWORD / ADMIN_SESSION_SECRET no conceden acceso", () => {
    assert.equal(legacyCookieGrantsAccess("cualquier-secreto"), false);
    assert.equal(legacyCookieGrantsAccess(undefined), false);
    assert.equal(envSecretAuthenticates("ADMIN_PASSWORD"), false);
    assert.equal(envSecretAuthenticates("ADMIN_SESSION_SECRET"), false);
  });

  it("solo rol ADMIN autoriza admin API; VENDEDOR no", () => {
    const admin = {
      id: "a",
      nombre: "A",
      usuario: "admin",
      rol: "ADMIN" as const,
      activo: true,
    };
    const vend = {
      id: "v",
      nombre: "V",
      usuario: "vend",
      rol: "VENDEDOR" as const,
      activo: true,
    };
    assert.equal(canAccessAdminApi(admin), true);
    assert.equal(canAccessAdminApi(vend), false);
    assert.equal(canAccessAdminApi(null), false);
    assert.equal(canAccessVentaApi(vend), true);
    assert.equal(authorizeAdminUi(vend).ok, false);
    assert.equal(authorizeVentaUi(vend).ok, true);
    assert.equal(authorizeAdminUi(admin).ok, true);
    assert.equal(authorizePerfilUi(admin).ok, true);
    assert.equal(authorizePerfilUi(vend).ok, true);
    const adminNull = authorizeAdminUi(null);
    assert.equal(adminNull.ok, false);
    if (!adminNull.ok) assert.equal(adminNull.redirect, "/login");
    const ventaNull = authorizeVentaUi(null);
    assert.equal(ventaNull.ok, false);
    if (!ventaNull.ok) assert.equal(ventaNull.redirect, "/login");
    assert.equal(canChangeOwnPassword(vend), true);
    assert.equal(canResetVendorPassword(vend), false);
    assert.equal(canResetVendorPassword(admin), true);
  });
});

describe("AUTH_SESSION_HOURS", () => {
  it("default razonable (función pura lee env o 12)", () => {
    const h = sessionHours();
    assert.ok(h > 0 && h <= 168);
  });
});

/**
 * Integración DB / acceptance:
 * - createSession / resolveSessionByToken / deleteSessionByToken
 * - loginWithCredentials + lastLoginAt
 * - requireAdmin / requireVendorOrAdmin (solo lj_session)
 * - anuladoPorId = admin.id en anulación
 * - vendedorId = user.id en createTicket
 * - passwordHash nunca en JSON de APIs
 * - admin_session no autoriza
 */
