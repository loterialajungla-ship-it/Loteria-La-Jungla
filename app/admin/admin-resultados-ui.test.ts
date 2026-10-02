import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estadoResultadoTexto,
  etiquetaResultadoAnimal,
  formatResultadoLabel,
  mensajeErrorResultado,
  parseResultadoApiOk,
  resumenExposicionCompacto,
} from "@/app/admin/admin-resultados-ui";

const animales = [
  { numero: "03", nombre: "Ciempiés" },
  { numero: "05", nombre: "León" },
];

describe("admin-resultados-ui — resultado actual", () => {
  it("resultado pendiente cuando no hay número", () => {
    assert.equal(etiquetaResultadoAnimal(animales, ""), null);
    assert.equal(formatResultadoLabel(null), null);
    assert.equal(estadoResultadoTexto(false), "PENDIENTE");
  });

  it("resultado existente muestra numero - nombre del catálogo", () => {
    const r = etiquetaResultadoAnimal(animales, "03");
    assert.deepEqual(r, { numero: "03", nombre: "Ciempiés" });
    assert.equal(formatResultadoLabel(r), "03 - Ciempiés");
    assert.equal(estadoResultadoTexto(true), "PUBLICADO");
  });

  it("no hardcodea nombres: usa catálogo", () => {
    const r = etiquetaResultadoAnimal(animales, "05");
    assert.equal(r?.nombre, "León");
  });
});

describe("admin-resultados-ui — guardar / modificar respuesta API", () => {
  it("parsea respuesta ok de guardar resultado", () => {
    const parsed = parseResultadoApiOk({
      ok: true,
      resultado: { hora: 14, numero: "03", nombre: "Ciempiés" },
    });
    assert.ok(parsed);
    assert.equal(parsed!.resultado.numero, "03");
    assert.equal(parsed!.resultado.nombre, "Ciempiés");
  });

  it("rechaza payload inválido", () => {
    assert.equal(parseResultadoApiOk({ ok: true }), null);
    assert.equal(parseResultadoApiOk({ error: "Datos inválidos" }), null);
  });

  it("mensajes de error amigables sin stack", () => {
    assert.equal(
      mensajeErrorResultado({ error: "Animal no encontrado" }),
      "Animal no encontrado",
    );
    assert.equal(
      mensajeErrorResultado({ error: { message: "Datos inválidos" } }),
      "Datos inválidos",
    );
    assert.equal(mensajeErrorResultado({}), "No se pudo guardar el resultado.");
  });
});

describe("admin-resultados-ui — resumen exposición (sin recalcular)", () => {
  it("formatea tickets + jugado desde strings de la API", () => {
    assert.equal(
      resumenExposicionCompacto({
        ticketsAfectados: 4,
        totalApostado: "12.50",
      }),
      "Tickets: 4 · Jugado: $12.50",
    );
  });
});
