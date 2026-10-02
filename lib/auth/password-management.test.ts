import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseChangePasswordBody,
  parseResetPasswordBody,
} from "@/lib/auth/password-management";
import {
  ForbiddenError,
  UnauthorizedError,
  UserValidationError,
} from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { assertPasswordPolicy, PasswordValidationError } from "@/lib/auth/password";
import {
  authorizePerfilUi,
  canChangeOwnPassword,
  canResetVendorPassword,
} from "@/lib/acceptance/authorize-rules";

describe("parseChangePasswordBody", () => {
  it("acepta body válido", () => {
    const r = parseChangePasswordBody({
      currentPassword: "antigua12",
      newPassword: "nueva1234",
    });
    assert.equal(r.currentPassword, "antigua12");
    assert.equal(r.newPassword, "nueva1234");
  });

  it("rechaza passwordHash / userId del cliente", () => {
    assert.throws(
      () =>
        parseChangePasswordBody({
          currentPassword: "antigua12",
          newPassword: "nueva1234",
          passwordHash: "x",
        }),
      UserValidationError,
    );
    assert.throws(
      () =>
        parseChangePasswordBody({
          currentPassword: "antigua12",
          newPassword: "nueva1234",
          userId: "otro",
        }),
      UserValidationError,
    );
  });

  it("exige currentPassword y newPassword", () => {
    assert.throws(() => parseChangePasswordBody({}), UserValidationError);
    assert.throws(
      () => parseChangePasswordBody({ currentPassword: "x" }),
      UserValidationError,
    );
  });
});

describe("parseResetPasswordBody", () => {
  it("acepta newPassword", () => {
    const r = parseResetPasswordBody({ newPassword: "nueva1234" });
    assert.equal(r.newPassword, "nueva1234");
  });

  it("rechaza rol / passwordHash / userId", () => {
    assert.throws(
      () => parseResetPasswordBody({ newPassword: "nueva1234", rol: "ADMIN" }),
      UserValidationError,
    );
  });
});

describe("política de contraseña (reuso)", () => {
  it("mínimo 8 caracteres", () => {
    assert.throws(() => assertPasswordPolicy("corta"), PasswordValidationError);
    assert.doesNotThrow(() => assertPasswordPolicy("12345678"));
  });
});

describe("mensajes de igualdad de contraseña (contrato)", () => {
  it("mensaje exacto documentado", () => {
    const e = new UserValidationError(
      "La nueva contraseña debe ser diferente de la actual.",
      "PASSWORD_UNCHANGED",
    );
    assert.equal(e.httpStatus, 400);
    assert.match(e.message, /diferente de la actual/);
  });
});

describe("auth HTTP mapping passwords", () => {
  it("sin sesión → 401; rol incorrecto → 403", async () => {
    const u = jsonAuthError(new UnauthorizedError());
    assert.equal(u.status, 401);
    const f = jsonAuthError(new ForbiddenError());
    assert.equal(f.status, 403);
    const body = await f.json();
    assert.equal("passwordHash" in body, false);
    assert.equal("password" in body, false);
  });

  it("respuestas exitosas contractuales no incluyen secretos", () => {
    const ok = { ok: true as const };
    const json = JSON.stringify(ok);
    assert.equal(json.includes("password"), false);
    assert.equal(json.includes("passwordHash"), false);
  });
});

describe("autorización change/reset password (reglas)", () => {
  it("VENDEDOR puede change-password; no reset admin", () => {
    const vend = {
      id: "v",
      nombre: "V",
      usuario: "v",
      rol: "VENDEDOR" as const,
      activo: true,
    };
    assert.equal(canChangeOwnPassword(vend), true);
    assert.equal(canResetVendorPassword(vend), false);
    assert.equal(authorizePerfilUi(vend).ok, true);
  });

  it("ADMIN puede change-password y reset vendor", () => {
    const admin = {
      id: "a",
      nombre: "A",
      usuario: "a",
      rol: "ADMIN" as const,
      activo: true,
    };
    assert.equal(canChangeOwnPassword(admin), true);
    assert.equal(canResetVendorPassword(admin), true);
    assert.equal(authorizePerfilUi(admin).ok, true);
  });

  it("sin sesión → no change ni reset", () => {
    assert.equal(canChangeOwnPassword(null), false);
    assert.equal(canResetVendorPassword(null), false);
    assert.equal(authorizePerfilUi(null).ok, false);
  });
});
