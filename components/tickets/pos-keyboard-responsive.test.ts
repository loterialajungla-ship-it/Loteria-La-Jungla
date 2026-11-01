import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicketSummary } from "@/components/tickets/TicketSummary";
import { AnimalGrid } from "@/components/tickets/AnimalGrid";
import { PosHourTabs } from "@/components/tickets/PosHourTabs";
import {
  normalizarImporteUi,
  puedeCrearTicket,
  upsertLinea,
} from "@/components/tickets/pos-state";

const root = path.resolve(__dirname, "../..");

function readSrc(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("POS teclado / TicketSummary (D.3.E)", () => {
  it("barra inferior usa visualViewport + safe-area; conserva Crear y total", () => {
    const src = readSrc("components/tickets/TicketSummary.tsx");
    assert.match(src, /useVisualViewportBottomMetrics/);
    assert.match(src, /data-pos-bottom-bar/);
    assert.match(src, /safe-area-inset-bottom/);
    assert.match(src, /bottomInset/);
    assert.match(src, /panelMaxHeightPx/);
    assert.match(src, /max-h-\[min\(55dvh,55vh\)\]/);
    assert.match(src, /overscroll-contain/);
    assert.match(src, /Crear ticket/);
    assert.match(src, /Total jugado/);
    // No depende solo de z-index / overflow como “solución”
    assert.doesNotMatch(src, /fixed inset-x-0 bottom-0 z-30/);
  });

  it("hook limpia listeners; no APIs experimentales como única vía", () => {
    const hook = readSrc("lib/ui/use-visual-viewport-bottom.ts");
    assert.match(hook, /removeEventListener/);
    assert.match(hook, /visualViewport/);
    assert.doesNotMatch(hook, /keyboard-inset-bottom/);
    assert.doesNotMatch(hook, /VirtualKeyboard/);
  });

  it("SSR: panel conserva total, Crear y safe-area sin lanzar", () => {
    const html = renderToStaticMarkup(
      createElement(TicketSummary, {
        fechaJuego: "2026-11-01",
        apuestas: { "10": { "03": "2.00" } },
        animales: [{ numero: "03", nombre: "Delfín" }],
        creando: false,
        onChange: () => {},
        onCrear: () => {},
      }),
    );
    assert.match(html, /data-pos-bottom-bar/);
    assert.match(html, /\$2/);
    assert.match(html, /Crear/);
    assert.match(html, /safe-area-inset-bottom/);
    assert.match(html, /Resumen del ticket/);
    assert.match(html, /min-h-11/);
  });

  it("campos importe conservan inputMode decimal y validación pos-state", () => {
    const summary = readSrc("components/tickets/TicketSummary.tsx");
    const grid = readSrc("components/tickets/AnimalGrid.tsx");
    assert.match(summary, /inputMode="decimal"/);
    assert.match(grid, /inputMode="decimal"/);
    assert.match(summary, /scrollFocusedControlIntoView/);
    assert.match(grid, /scrollFocusedControlIntoView/);
    assert.match(summary, /min-h-11/);
    assert.match(grid, /min-h-11/);

    let apuestas = upsertLinea({}, 10, "03", "2.50");
    assert.equal(normalizarImporteUi("2.50"), "2.50");
    assert.equal(puedeCrearTicket(apuestas), true);
    apuestas = upsertLinea(apuestas, 10, "03", "abc");
    assert.equal(normalizarImporteUi("abc"), "");
    assert.equal(puedeCrearTicket(apuestas), false);
  });

  it("TicketPOS reserva espacio inferior con safe-area; no altera crearTicket", () => {
    const src = readSrc("components/tickets/TicketPOS.tsx");
    assert.match(src, /safe-area-inset-bottom/);
    assert.match(src, /pb-\[calc\(7\.5rem/);
    assert.match(src, /TicketSummary/);
    assert.match(src, /AnimalGrid/);
    assert.match(src, /PosHourTabs/);
    // contrato funcional intacto
    assert.match(src, /crearTicket|onCrear/);
    assert.doesNotMatch(src, /multiplicador|30\s*\*/);
  });
});

describe("AnimalGrid / PosHourTabs responsive táctil (D.3.E)", () => {
  it("AnimalGrid: grid responsive + importe táctil sin cambiar catálogo", () => {
    const html = renderToStaticMarkup(
      createElement(AnimalGrid, {
        animales: [
          { numero: "01", nombre: "Ballena" },
          { numero: "02", nombre: "Toro" },
        ],
        seleccion: { "01": "1.00" },
        onToggle: () => {},
        onImporteChange: () => {},
      }),
    );
    assert.match(html, /Catálogo de animales/);
    assert.match(html, /grid-cols-2/);
    assert.match(html, /min-h-11/);
    assert.match(html, /inputMode="decimal"/);
    assert.match(html, /Ballena/);
    assert.match(html, /Toro/);
  });

  it("PosHourTabs: scroll horizontal + min-h-11; horas intactas", () => {
    const src = readSrc("components/tickets/PosHourTabs.tsx");
    assert.match(src, /overflow-x-auto/);
    assert.match(src, /min-h-11/);
    assert.match(src, /overscroll-x-contain/);

    const html = renderToStaticMarkup(
      createElement(PosHourTabs, {
        horas: [
          { hora: 10, abierta: true },
          { hora: 11, abierta: false, motivoCierre: "HORA_LLEGADA" },
        ],
        horaActiva: 10,
        conteos: { "10": 1 },
        onSelectHora: () => {},
        onActualizar: () => {},
      }),
    );
    assert.match(html, /role="tablist"/);
    assert.match(html, /aria-selected="true"/);
    assert.match(html, /min-h-11/);
  });
});

// Evita tree-shake de React en algunos runners SSR
void React;
