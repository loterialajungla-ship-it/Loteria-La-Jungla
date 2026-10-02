import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_FORBIDDEN_DETAIL_KEYS,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  parseAuditDetalle,
  sanitizeAuditDetalle,
  serializeAuditDetalle,
} from "@/lib/audit/audit";
import { formatAuditDetalleLegible } from "@/lib/audit/format-detalle";
import { parseListAuditoriaQuery } from "@/lib/audit/list-auditoria";
import { UserValidationError } from "@/lib/auth/errors";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";
import { jsonAuthError } from "@/lib/auth/http";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";

describe("sanitizeAuditDetalle / serialize", () => {
  it("evento con detalle limpio", () => {
    const d = sanitizeAuditDetalle({
      motivo: "Error",
      numeroVisible: "20261002-000001",
    });
    assert.deepEqual(d, {
      motivo: "Error",
      numeroVisible: "20261002-000001",
    });
    assert.equal(
      serializeAuditDetalle(d),
      JSON.stringify({
        motivo: "Error",
        numeroVisible: "20261002-000001",
      }),
    );
  });

  it("evento sin detalle → null", () => {
    assert.equal(sanitizeAuditDetalle(null), null);
    assert.equal(sanitizeAuditDetalle({}), null);
    assert.equal(serializeAuditDetalle(undefined), null);
  });

  it("no permite secretos", () => {
    for (const key of AUDIT_FORBIDDEN_DETAIL_KEYS) {
      const cleaned = sanitizeAuditDetalle({
        [key]: "secreto",
        motivo: "ok",
      });
      assert.equal(cleaned && key in cleaned, false);
      assert.equal(cleaned?.motivo, "ok");
    }
    const nested = sanitizeAuditDetalle({
      password: "x",
      token: "y",
      passwordHash: "z",
      idempotencyKey: "k",
      fecha: "2026-10-02",
    });
    assert.deepEqual(nested, { fecha: "2026-10-02" });
  });

  it("parse JSON serializado", () => {
    const raw = serializeAuditDetalle({
      numeroAnterior: "03",
      numeroNuevo: "05",
      password: "no",
    });
    const parsed = parseAuditDetalle(raw);
    assert.deepEqual(parsed, {
      numeroAnterior: "03",
      numeroNuevo: "05",
    });
  });
});

describe("paginación / filtros auditoría", () => {
  it("defaults 20, max 100", () => {
    assert.equal(AUDIT_PAGE_SIZE_DEFAULT, 20);
    assert.equal(AUDIT_PAGE_SIZE_MAX, 100);
    const q = parseListAuditoriaQuery({});
    assert.equal(q.page, 1);
    assert.equal(q.pageSize, 20);
    const capped = parseListAuditoriaQuery({ pageSize: "500" });
    assert.equal(capped.pageSize, 100);
  });

  it("filtros accion/entidad/fecha", () => {
    const q = parseListAuditoriaQuery({
      fecha: "2026-10-02",
      accion: "MODIFICAR_RESULTADO",
      entidad: "RESULTADO",
      usuarioId: "abc",
    });
    assert.ok(q.fecha);
    assert.equal(q.accion, "MODIFICAR_RESULTADO");
    assert.equal(q.entidad, "RESULTADO");
    assert.equal(q.usuarioId, "abc");
  });

  it("fecha inválida → 400", () => {
    assert.throws(
      () => parseListAuditoriaQuery({ fecha: "no-fecha" }),
      UserValidationError,
    );
  });
});

describe("formato legible", () => {
  it("MODIFICAR_RESULTADO 03 → 05", () => {
    const names = new Map([
      ["03", "Ciempiés"],
      ["05", "León"],
    ]);
    const text = formatAuditDetalleLegible({
      accion: "MODIFICAR_RESULTADO",
      entidad: "RESULTADO",
      entidadId: "r1",
      detalle: {
        fecha: "2026-10-02",
        hora: 12,
        numeroAnterior: "03",
        numeroNuevo: "05",
      },
      nombrePorNumero: names,
    });
    assert.match(text, /03 - Ciempiés/);
    assert.match(text, /05 - León/);
    assert.match(text, /→/);
  });

  it("ANULAR_TICKET con motivo", () => {
    const text = formatAuditDetalleLegible({
      accion: "ANULAR_TICKET",
      entidad: "TICKET",
      entidadId: "t1",
      detalle: { numeroVisible: "20261002-000001", motivo: "Error" },
    });
    assert.match(text, /Error/);
    assert.match(text, /20261002-000001/);
  });
});

describe("autorización API auditoría", () => {
  it("ADMIN ok; VENDEDOR no; sin sesión no", async () => {
    assert.equal(
      canAccessAdminApi({
        id: "1",
        nombre: "A",
        usuario: "a",
        rol: "ADMIN",
        activo: true,
      }),
      true,
    );
    assert.equal(
      canAccessAdminApi({
        id: "2",
        nombre: "V",
        usuario: "v",
        rol: "VENDEDOR",
        activo: true,
      }),
      false,
    );
    assert.equal(jsonAuthError(new UnauthorizedError()).status, 401);
    assert.equal(jsonAuthError(new ForbiddenError()).status, 403);
  });
});
