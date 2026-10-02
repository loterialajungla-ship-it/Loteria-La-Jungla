import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

describe("Prisma schema — Usuario / sesiones / Ticket", () => {
  it("schema.prisma es legible y contiene modelos clave", () => {
    assert.match(schema, /model Usuario\s*\{/);
    assert.match(schema, /model UsuarioSesion\s*\{/);
    assert.match(schema, /model Ticket\s*\{/);
    assert.match(schema, /model Animal\s*\{/);
    assert.match(schema, /model Resultado\s*\{/);
  });

  it("enum RolUsuario con ADMIN y VENDEDOR únicamente", () => {
    assert.match(schema, /enum RolUsuario\s*\{/);
    assert.match(schema, /\bADMIN\b/);
    assert.match(schema, /\bVENDEDOR\b/);
    assert.doesNotMatch(schema, /SUPERADMIN|CAJERO|SUPERVISOR/);
  });

  it("Usuario.usuario es UNIQUE y passwordHash sin campos planos", () => {
    assert.match(schema, /usuario\s+String\s+@unique/);
    assert.match(schema, /passwordHash\s+String/);
    assert.doesNotMatch(schema, /\bpassword\s+String/);
    assert.doesNotMatch(schema, /plainPassword|adminPassword/);
  });

  it("UsuarioSesion.tokenHash UNIQUE e índices útiles", () => {
    const sesion = schema.match(/model UsuarioSesion\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(sesion);
    assert.match(sesion!, /tokenHash\s+String\s+@unique/);
    assert.match(sesion!, /@@index\(\[usuarioId\]\)/);
    assert.match(sesion!, /@@index\(\[expiresAt\]\)/);
    assert.match(sesion!, /onDelete:\s*Cascade/);
  });

  it("Usuario tiene índice (rol, activo)", () => {
    const usuario = schema.match(/model Usuario\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(usuario);
    assert.match(usuario!, /@@index\(\[rol,\s*activo\]\)/);
    assert.match(usuario!, /activo\s+Boolean\s+@default\(true\)/);
  });

  it("Ticket.vendedorId y anuladoPorId nullable con Restrict", () => {
    const ticket = schema.match(/model Ticket\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(ticket);
    assert.match(ticket!, /vendedorId\s+String\?/);
    assert.match(ticket!, /anuladoPorId\s+String\?/);
    assert.match(ticket!, /TicketVendedor/);
    assert.match(ticket!, /TicketAnuladoPor/);
    assert.match(ticket!, /onDelete:\s*Restrict/);
  });

  it("Usuario expone ticketsVendidos y ticketsAnulados", () => {
    const usuario = schema.match(/model Usuario\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(usuario);
    assert.match(usuario!, /ticketsVendidos/);
    assert.match(usuario!, /ticketsAnulados/);
  });

  it("no altera campos críticos de Ticket", () => {
    const ticket = schema.match(/model Ticket\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(ticket);
    for (const campo of [
      "numeroVisible",
      "codigoPublico",
      "fechaJuego",
      "totalApostado",
      "multiplicadorUsado",
      "estado",
    ]) {
      assert.match(ticket!, new RegExp(campo));
    }
  });
});

/**
 * Documenta reglas de integridad para PostgreSQL real (pendiente harness):
 * - Ticket puede tener vendedorId/anuladoPorId NULL.
 * - FK Restrict impide borrar Usuario con tickets asociados.
 * - UsuarioSesion.tokenHash UNIQUE.
 * - Usuario.usuario UNIQUE.
 */
describe("integridad conceptual (documentada)", () => {
  it("Restrict en Ticket→Usuario protege histórico al desactivar/eliminar conceptualmente", () => {
    assert.match(schema, /TicketVendedor[\s\S]*onDelete:\s*Restrict/);
    assert.match(schema, /TicketAnuladoPor[\s\S]*onDelete:\s*Restrict/);
  });

  it("múltiples sesiones por usuario vía usuarioId indexado", () => {
    assert.match(schema, /sesiones\s+UsuarioSesion\[\]/);
    assert.match(schema, /usuarioId\s+String/);
  });
});
