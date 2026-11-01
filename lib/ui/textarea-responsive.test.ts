import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "@/components/ui/Textarea";

function assertHasClassTokens(classAttr: string, tokens: string[]) {
  const set = new Set(classAttr.split(/\s+/).filter(Boolean));
  for (const token of tokens) {
    assert.ok(set.has(token), `falta "${token}" en "${classAttr}"`);
  }
}

function firstClassAttr(html: string, tag: "div" | "textarea"): string {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*\\sclass="([^"]*)"`, "i"));
  assert.ok(m?.[1], `sin class en <${tag}>`);
  return m[1];
}

function classTokenSet(html: string): Set<string> {
  return new Set(firstClassAttr(html, "textarea").split(/\s+/).filter(Boolean));
}

describe("Textarea — API y patrón responsive (D.3.F / D.3.H)", () => {
  it("contenedor/control: w-full min-w-0 max-w-full box-border; label y rows", () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, {
        name: "motivo",
        label: "Motivo",
        rows: 4,
        defaultValue: "Error de digitación",
      }),
    );
    assertHasClassTokens(firstClassAttr(html, "div"), ["w-full", "min-w-0"]);
    assertHasClassTokens(firstClassAttr(html, "textarea"), [
      "w-full",
      "min-w-0",
      "max-w-full",
      "box-border",
      "resize-y",
    ]);
    assert.match(html, /for="motivo"/);
    assert.match(html, /id="motivo"/);
    assert.match(html, /rows="4"/);
    assert.match(html, /data-variant="default"/);
    assert.match(html, /Motivo/);
    assert.match(html, /Error de digitación/);
  });

  it("variant danger: solo foco danger; no mezcla brand (G-03)", () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, {
        name: "motivo",
        label: "Motivo",
        variant: "danger",
      }),
    );
    const tokens = classTokenSet(html);
    assert.match(html, /data-variant="danger"/);
    assert.ok(tokens.has("border-danger-700"));
    assert.ok(tokens.has("focus-visible:border-danger-700"));
    assert.ok(tokens.has("focus-visible:ring-danger-100"));
    assert.equal(tokens.has("focus-visible:border-brand-600"), false);
    assert.equal(tokens.has("focus-visible:ring-brand-200"), false);
  });

  it("variant default: foco brand; sin clases danger de foco", () => {
    const html = renderToStaticMarkup(
      createElement(Textarea, {
        name: "notas",
        label: "Notas",
        variant: "default",
      }),
    );
    const tokens = classTokenSet(html);
    assert.ok(tokens.has("focus-visible:border-brand-600"));
    assert.ok(tokens.has("focus-visible:ring-brand-200"));
    assert.equal(tokens.has("focus-visible:border-danger-700"), false);
    assert.equal(tokens.has("focus-visible:ring-danger-100"), false);
  });

  it("error, hint, disabled y focus-visible", () => {
    const withError = renderToStaticMarkup(
      createElement(Textarea, {
        name: "a",
        label: "A",
        error: "Obligatorio",
      }),
    );
    assert.match(withError, /role="alert"/);
    assert.match(withError, /Obligatorio/);
    assert.match(withError, /aria-invalid="true"/);
    assert.match(withError, /data-variant="danger"/);
    assert.match(withError, /border-danger-700/);
    const errTokens = classTokenSet(withError);
    assert.equal(errTokens.has("focus-visible:border-brand-600"), false);

    const withHint = renderToStaticMarkup(
      createElement(Textarea, {
        name: "b",
        label: "B",
        hint: "Máx. 200",
      }),
    );
    assert.match(withHint, /Máx\. 200/);
    assert.match(withHint, /id="b-hint"/);

    const disabled = renderToStaticMarkup(
      createElement(Textarea, {
        name: "c",
        label: "C",
        disabled: true,
      }),
    );
    assert.match(disabled, /disabled/);
    assert.match(firstClassAttr(disabled, "textarea"), /focus-visible:ring-2/);
  });

  it("migraciones: variant danger sin overrides de focus contradictorios", () => {
    const root = path.resolve(__dirname, "../..");
    const anular = fs.readFileSync(
      path.join(root, "components/tickets/AnularTicketPanel.tsx"),
      "utf8",
    );
    const fila = fs.readFileSync(
      path.join(root, "app/admin/AdminFilaResultado.tsx"),
      "utf8",
    );
    assert.match(anular, /Textarea/);
    assert.match(anular, /variant="danger"/);
    assert.match(anular, /MOTIVO_ANULACION_MAX/);
    assert.match(anular, /maxLength=\{MOTIVO_ANULACION_MAX\}/);
    assert.match(anular, /Describe el motivo/);
    assert.doesNotMatch(anular, /<textarea\b/);
    assert.doesNotMatch(anular, /focus-visible:border-brand-600/);

    assert.match(fila, /Textarea/);
    assert.match(fila, /variant="danger"/);
    assert.match(fila, /MOTIVO_CORRECCION_MAX/);
    assert.match(fila, /maxLength=\{MOTIVO_CORRECCION_MAX\}/);
    assert.doesNotMatch(fila, /<textarea\b/);
  });
});
