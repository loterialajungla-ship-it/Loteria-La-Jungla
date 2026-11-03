import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TICKET_CREATOR_UNAVAILABLE_LABEL,
  formatTicketCreatorDisplay,
} from "@/lib/tickets/ticket-creator-display";

describe("formatTicketCreatorDisplay", () => {
  it("histórico sin vendedor → No disponible", () => {
    const d = formatTicketCreatorDisplay(null);
    assert.equal(d.disponible, false);
    assert.equal(d.etiqueta, TICKET_CREATOR_UNAVAILABLE_LABEL);
    assert.equal(d.nombre, null);
    assert.equal(d.usuario, null);
    assert.equal(d.rol, null);
    assert.equal(d.id, null);
  });

  it("vendedor con nombre usa el nombre", () => {
    const d = formatTicketCreatorDisplay({
      id: "u1",
      nombre: "Ana Pérez",
      usuario: "ana",
      rol: "VENDEDOR",
    });
    assert.equal(d.disponible, true);
    assert.equal(d.etiqueta, "Ana Pérez");
    assert.equal(d.nombre, "Ana Pérez");
    assert.equal(d.usuario, "ana");
    assert.equal(d.rol, "VENDEDOR");
    assert.equal(d.id, "u1");
  });

  it("vendedor sin nombre cae al usuario de acceso", () => {
    const d = formatTicketCreatorDisplay({
      id: "u2",
      nombre: "   ",
      usuario: "vend_02",
      rol: "VENDEDOR",
    });
    assert.equal(d.disponible, true);
    assert.equal(d.etiqueta, "vend_02");
    assert.equal(d.nombre, null);
    assert.equal(d.usuario, "vend_02");
  });

  it("ADMIN se identifica como administrador", () => {
    const d = formatTicketCreatorDisplay({
      id: "a1",
      nombre: "Reynaldo",
      usuario: "adminlajungla",
      rol: "ADMIN",
    });
    assert.equal(d.disponible, true);
    assert.equal(d.rol, "ADMIN");
    assert.match(d.etiqueta, /Administrador/);
    assert.match(d.etiqueta, /Reynaldo/);
    assert.equal(d.usuario, "adminlajungla");
  });

  it("ADMIN sin nombre usa usuario en la etiqueta", () => {
    const d = formatTicketCreatorDisplay({
      id: "a2",
      nombre: "",
      usuario: "admin",
      rol: "ADMIN",
    });
    assert.equal(d.etiqueta, "Administrador · admin");
  });

  it("atribución por id permanece aunque cambien nombre/usuario visibles", () => {
    const sameId = "hist-9";
    const before = formatTicketCreatorDisplay({
      id: sameId,
      nombre: "Nombre Viejo",
      usuario: "viejo",
      rol: "VENDEDOR",
    });
    const after = formatTicketCreatorDisplay({
      id: sameId,
      nombre: "Nombre Nuevo",
      usuario: "nuevo",
      rol: "VENDEDOR",
    });
    assert.equal(before.id, after.id);
    assert.equal(after.etiqueta, "Nombre Nuevo");
    assert.equal(after.usuario, "nuevo");
  });
});
