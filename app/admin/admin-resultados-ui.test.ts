import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codigoErrorResultado,
  estadoResultadoTexto,
  etiquetaResultadoAnimal,
  formatResultadoLabel,
  mensajeErrorResultado,
  mensajeExitoProgramacion,
  parseAdminResultadosApiOk,
  parseProgramacionApiOk,
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
      resultado: {
        hora: 14,
        numero: "03",
        nombre: "Ciempiés",
        origen: "MANUAL",
      },
    });
    assert.ok(parsed);
    assert.equal(parsed!.kind, "resultado");
    assert.equal(parsed!.resultado.numero, "03");
    assert.equal(parsed!.resultado.nombre, "Ciempiés");
    assert.equal(parsed!.resultado.origen, "MANUAL");
  });

  it("parsea programación futura sin exigir resultado", () => {
    const parsed = parseProgramacionApiOk({
      ok: true,
      programacion: {
        action: "created",
        hora: 11,
        numero: "20",
        nombre: "Cerdo",
        estado: "PENDIENTE",
      },
    });
    assert.ok(parsed);
    assert.equal(parsed!.kind, "programacion");
    assert.equal(parsed!.programacion.action, "created");
    assert.equal(parseResultadoApiOk({
      ok: true,
      programacion: {
        action: "created",
        hora: 11,
        numero: "20",
        nombre: "Cerdo",
        estado: "PENDIENTE",
      },
    }), null);
  });

  it("parsea cancelación de programación", () => {
    const parsed = parseAdminResultadosApiOk({
      ok: true,
      programacion: {
        action: "cancelled",
        hora: 11,
        numero: "20",
        nombre: "Cerdo",
        estado: "CANCELADO",
      },
    });
    assert.ok(parsed && parsed.kind === "programacion");
    assert.match(
      mensajeExitoProgramacion(parsed.programacion),
      /cancelada/i,
    );
  });

  it("no interpreta error como éxito", () => {
    assert.equal(
      parseAdminResultadosApiOk({
        ok: false,
        error: { code: "SCHEDULE_CONFLICT", message: "Conflicto" },
      }),
      null,
    );
  });

  it("rechaza payload inválido", () => {
    assert.equal(parseResultadoApiOk({ ok: true }), null);
    assert.equal(parseResultadoApiOk({ error: "Datos inválidos" }), null);
    assert.equal(
      parseProgramacionApiOk({
        ok: true,
        programacion: { action: "created", hora: 9 },
      }),
      null,
    );
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

  it("extrae código estructurado de corrección/conflicto", () => {
    assert.equal(
      codigoErrorResultado({
        error: { code: "CORRECTION_REQUIRED", message: "Confirma" },
      }),
      "CORRECTION_REQUIRED",
    );
    assert.equal(
      codigoErrorResultado({
        error: { code: "RESULT_CONFLICT", message: "Cambió" },
      }),
      "RESULT_CONFLICT",
    );
    assert.equal(codigoErrorResultado({ error: "texto" }), null);
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
