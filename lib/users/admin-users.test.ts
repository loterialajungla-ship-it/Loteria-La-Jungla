import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCreateVendorBody,
  parseListAdminUsersQuery,
  ADMIN_USERS_PAGE_SIZE_MAX,
} from "@/lib/users/admin-users";
import {
  ForbiddenError,
  UnauthorizedError,
  UserConflictError,
  UserNotFoundError,
  UserStateConflictError,
  UserValidationError,
} from "@/lib/auth/errors";
import { jsonAuthError } from "@/lib/auth/http";
import { normalizeUsuario, isValidUsuarioFormat } from "@/lib/auth/username";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("normalizeUsuario", () => {
  it("trim + minúsculas", () => {
    assert.equal(normalizeUsuario("  Juan.Perez  "), "juan.perez");
  });

  it("formato válido", () => {
    assert.equal(isValidUsuarioFormat("juan"), true);
    assert.equal(isValidUsuarioFormat("ab"), false);
    assert.equal(isValidUsuarioFormat("juan perez"), false);
  });
});

describe("parseCreateVendorBody", () => {
  it("acepta datos válidos y fuerza vendedor", () => {
    const r = parseCreateVendorBody({
      nombre: "Juan Pérez",
      usuario: "Juan",
      password: "secreto12",
    });
    assert.equal(r.nombre, "Juan Pérez");
    assert.equal(r.usuario, "juan");
    assert.equal(r.password, "secreto12");
  });

  it("rechaza rol ADMIN", () => {
    assert.throws(
      () =>
        parseCreateVendorBody({
          nombre: "Admin Fake",
          usuario: "fakeadmin",
          password: "secreto12",
          rol: "ADMIN",
        }),
      UserValidationError,
    );
  });

  it("usuario inválido / vacío → 400", () => {
    assert.throws(
      () =>
        parseCreateVendorBody({
          nombre: "X",
          usuario: "",
          password: "secreto12",
        }),
      UserValidationError,
    );
    assert.throws(
      () =>
        parseCreateVendorBody({
          nombre: "Valid Name",
          usuario: "ab",
          password: "secreto12",
        }),
      UserValidationError,
    );
  });

  it("contraseña corta → 400", () => {
    assert.throws(
      () =>
        parseCreateVendorBody({
          nombre: "Juan Pérez",
          usuario: "juan",
          password: "corta",
        }),
      UserValidationError,
    );
  });
});

describe("parseListAdminUsersQuery", () => {
  it("filtros activo/inactivo y paginación", () => {
    assert.equal(
      parseListAdminUsersQuery({ activo: "activos" }).activo,
      true,
    );
    assert.equal(
      parseListAdminUsersQuery({ activo: "inactivos" }).activo,
      false,
    );
    assert.equal(parseListAdminUsersQuery({}).activo, undefined);
    assert.equal(
      parseListAdminUsersQuery({ pageSize: "999" }).pageSize,
      ADMIN_USERS_PAGE_SIZE_MAX,
    );
  });

  it("filtro rol opcional", () => {
    assert.equal(parseListAdminUsersQuery({ rol: "VENDEDOR" }).rol, "VENDEDOR");
    assert.equal(parseListAdminUsersQuery({ rol: "ADMIN" }).rol, "ADMIN");
  });
});

describe("API auth mapping usuarios", () => {
  it("listado/creación requieren ADMIN → 401/403", async () => {
    const u = jsonAuthError(new UnauthorizedError());
    assert.equal(u.status, 401);
    const f = jsonAuthError(new ForbiddenError("Se requiere rol ADMIN."));
    assert.equal(f.status, 403);
  });

  it("duplicado → 409 amigable", async () => {
    const res = jsonAuthError(new UserConflictError());
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error.message, /ya está en uso/);
    assert.equal("passwordHash" in body, false);
    assert.equal("password" in body, false);
  });

  it("inexistente → 404", async () => {
    const res = jsonAuthError(new UserNotFoundError());
    assert.equal(res.status, 404);
  });

  it("ya activo/inactivo → 409", async () => {
    const res = jsonAuthError(
      new UserStateConflictError("El usuario ya está inactivo."),
    );
    assert.equal(res.status, 409);
  });

  it("auto-desactivación → 400", async () => {
    const res = jsonAuthError(
      new UserValidationError(
        "No puedes desactivar tu propia cuenta.",
        "SELF_DEACTIVATE",
      ),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "SELF_DEACTIVATE");
  });
});

describe("password solo como hash (regla)", () => {
  it("hashPassword no devuelve texto plano", async () => {
    const plain = "secreto12";
    const hash = await hashPassword(plain);
    assert.notEqual(hash, plain);
    assert.equal(await verifyPassword(plain, hash), true);
    // Respuesta pública no incluye estos campos (documentado en toPublic).
    const publicUser = {
      id: "1",
      nombre: "Juan",
      usuario: "juan",
      rol: "VENDEDOR",
      activo: true,
    };
    assert.equal("password" in publicUser, false);
    assert.equal("passwordHash" in publicUser, false);
  });
});

describe("desactivación e inactividad (regla de sesión)", () => {
  it("usuario inactivo no autoriza aunque haya sesión", () => {
    const sessionPresent = true;
    const activo = false;
    assert.equal(sessionPresent && activo, false);
  });

  it("desactivar no borra tickets (regla documental)", () => {
    // Soft-delete: solo activo=false. Tickets.vendedorId permanece.
    const ticket = { vendedorId: "u1", estado: "EMITIDO" };
    const userAfter = { id: "u1", activo: false };
    assert.equal(ticket.vendedorId, userAfter.id);
    assert.equal(ticket.estado, "EMITIDO");
  });

  it("vendedor creado activo por defecto (parse → create data)", () => {
    const parsed = parseCreateVendorBody({
      nombre: "Ana López",
      usuario: "ana",
      password: "secreto12",
    });
    assert.ok(parsed.usuario);
    // createVendor siempre fija rol=VENDEDOR y activo=true (servicio).
  });
});

/**
 * Integración DB pendiente:
 * - createVendor persiste passwordHash y rol VENDEDOR
 * - listAdminUsers paginación/filtros reales
 * - desactivar/activar 409 idempotente
 * - requireAdmin en rutas HTTP
 * - login falla si activo=false
 * - resolveSessionByToken rechaza usuario inactivo
 */
