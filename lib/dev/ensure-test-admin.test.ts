import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENSURE_TEST_ADMIN_FORBIDDEN_UPDATE_KEYS,
  ENSURE_TEST_ADMIN_MISSING_OPT_IN,
  ENSURE_TEST_ADMIN_MISSING_PASSWORD,
  ENSURE_TEST_ADMIN_MISSING_USER,
  ENSURE_TEST_ADMIN_ROLE_CONFLICT,
  EnsureTestAdminError,
  assertEnsureTestAdminOptIn,
  assertEnsureUpdateFieldsSafe,
  parseEnsureTestAdminCredentials,
  planEnsureTestAdminUser,
} from "@/lib/dev/ensure-test-admin";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import { assertSafeTestDatabase } from "@/lib/tickets/integration/safe-test-db";

const SECRET = "ensure-test-admin-secret-never-leak";

function neonTestUrl(endpoint: string = NEON_ENDPOINTS.TEST): string {
  return `postgresql://u:${SECRET}@${endpoint}-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
  assert.doesNotMatch(text, /postgresql:\/\//i);
}

describe("assertEnsureTestAdminOptIn", () => {
  it("aborta sin ENSURE_TEST_ADMIN=1", () => {
    assert.throws(
      () => assertEnsureTestAdminOptIn({}),
      (e: unknown) =>
        e instanceof EnsureTestAdminError &&
        e.code === "MISSING_OPT_IN" &&
        e.message === ENSURE_TEST_ADMIN_MISSING_OPT_IN,
    );
    assert.throws(
      () => assertEnsureTestAdminOptIn({ ENSURE_TEST_ADMIN: "true" }),
      EnsureTestAdminError,
    );
    assert.throws(
      () => assertEnsureTestAdminOptIn({ ENSURE_TEST_ADMIN: "0" }),
      EnsureTestAdminError,
    );
  });

  it("acepta exactamente 1", () => {
    assert.doesNotThrow(() =>
      assertEnsureTestAdminOptIn({ ENSURE_TEST_ADMIN: "1" }),
    );
  });
});

describe("parseEnsureTestAdminCredentials", () => {
  it("exige usuario y contraseña", () => {
    assert.throws(
      () =>
        parseEnsureTestAdminCredentials({
          MANUAL_TEST_ADMIN_PASSWORD: "password12",
        }),
      (e: unknown) =>
        e instanceof EnsureTestAdminError &&
        e.message === ENSURE_TEST_ADMIN_MISSING_USER,
    );
    assert.throws(
      () =>
        parseEnsureTestAdminCredentials({
          MANUAL_TEST_ADMIN_USER: "manual_admin",
        }),
      (e: unknown) =>
        e instanceof EnsureTestAdminError &&
        e.message === ENSURE_TEST_ADMIN_MISSING_PASSWORD,
    );
  });

  it("normaliza usuario y aplica política de contraseña", () => {
    const c = parseEnsureTestAdminCredentials({
      MANUAL_TEST_ADMIN_USER: "  Manual_Admin  ",
      MANUAL_TEST_ADMIN_PASSWORD: "password12",
    });
    assert.equal(c.usuario, "manual_admin");
    assert.equal(c.password, "password12");

    assert.throws(
      () =>
        parseEnsureTestAdminCredentials({
          MANUAL_TEST_ADMIN_USER: "manual_admin",
          MANUAL_TEST_ADMIN_PASSWORD: "short",
        }),
      (e: unknown) =>
        e instanceof EnsureTestAdminError && e.code === "INVALID_PASSWORD",
    );
  });

  it("mensajes sin secretos", () => {
    try {
      parseEnsureTestAdminCredentials({
        MANUAL_TEST_ADMIN_USER: "manual_admin",
        MANUAL_TEST_ADMIN_PASSWORD: SECRET,
      });
    } catch (e) {
      assertNoSecrets(e instanceof Error ? e.message : String(e));
    }
  });
});

describe("planEnsureTestAdminUser / campos", () => {
  it("create solo con campos mínimos ADMIN", () => {
    const plan = planEnsureTestAdminUser({
      existing: null,
      usuario: "manual_admin",
      passwordHash: "hash-placeholder",
    });
    assert.equal(plan.action, "create");
    if (plan.action !== "create") return;
    assert.deepEqual(Object.keys(plan.fields).sort(), [
      "activo",
      "nombre",
      "passwordHash",
      "rol",
      "usuario",
    ]);
    assert.equal(plan.fields.rol, "ADMIN");
    assert.equal(plan.fields.activo, true);
  });

  it("update solo passwordHash + rol + activo; preserva nombre", () => {
    const plan = planEnsureTestAdminUser({
      existing: {
        id: "u1",
        usuario: "manual_admin",
        rol: "ADMIN",
        activo: false,
        nombre: "Nombre Conservado",
      },
      usuario: "manual_admin",
      passwordHash: "hash-new",
    });
    assert.equal(plan.action, "update");
    if (plan.action !== "update") return;
    assert.deepEqual(Object.keys(plan.fields).sort(), [
      "activo",
      "passwordHash",
      "rol",
    ]);
    assert.equal(plan.preserved.nombre, "Nombre Conservado");
    assertEnsureUpdateFieldsSafe(plan.fields);
    for (const k of ENSURE_TEST_ADMIN_FORBIDDEN_UPDATE_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(plan.fields, k),
        false,
      );
    }
  });

  it("aborta si el usuario existe con rol distinto de ADMIN", () => {
    assert.throws(
      () =>
        planEnsureTestAdminUser({
          existing: {
            id: "v1",
            usuario: "manual_admin",
            rol: "VENDEDOR",
            activo: true,
            nombre: "Vendedor",
          },
          usuario: "manual_admin",
          passwordHash: "hash",
        }),
      (e: unknown) =>
        e instanceof EnsureTestAdminError &&
        e.code === "ROLE_CONFLICT" &&
        e.message === ENSURE_TEST_ADMIN_ROLE_CONFLICT,
    );
  });
});

describe("endpoint TEST (guard existente, sin DB)", () => {
  it("rechaza endpoint que no es ep-muddy-fire-b44816w0", () => {
    assert.throws(
      () =>
        assertSafeTestDatabase({
          TEST_DATABASE_URL: neonTestUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        assertNoSecrets(msg);
        return /TEST|prohibido|ep-muddy-fire|ep-spring/i.test(msg);
      },
    );
    assert.throws(
      () =>
        assertSafeTestDatabase({
          TEST_DATABASE_URL: neonTestUrl(NEON_ENDPOINTS.DEV_RECOVERY),
        }),
      /TEST|prohibido|ep-delicate|ep-muddy/i,
    );
  });

  it("acepta URL sintética del endpoint TEST autorizado", () => {
    const url = assertSafeTestDatabase({
      TEST_DATABASE_URL: neonTestUrl(),
    });
    assert.match(url, /ep-muddy-fire-b44816w0/);
    assertNoSecrets("ok");
  });
});
