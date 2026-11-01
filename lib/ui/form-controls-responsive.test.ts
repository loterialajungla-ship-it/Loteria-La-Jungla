import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

/** Comprueba tokens CSS sin depender del orden de las clases. */
function assertHasClassTokens(classAttr: string, tokens: string[]) {
  const set = new Set(classAttr.split(/\s+/).filter(Boolean));
  for (const token of tokens) {
    assert.ok(
      set.has(token),
      `falta clase "${token}" en class="${classAttr}"`,
    );
  }
}

function firstClassAttr(html: string, tag: "div" | "input" | "select"): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\sclass="([^"]*)"`, "i");
  const m = html.match(re);
  assert.ok(m?.[1], `no se encontró class en <${tag}>: ${html.slice(0, 200)}`);
  return m[1];
}

describe("Input — patrón responsive (anti-overflow)", () => {
  it("contenedor: w-full min-w-0; control: w-full min-w-0 max-w-full box-border", () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        name: "fecha",
        label: "Fecha",
        type: "date",
        defaultValue: "2026-11-01",
      }),
    );
    assertHasClassTokens(firstClassAttr(html, "div"), ["w-full", "min-w-0"]);
    assertHasClassTokens(firstClassAttr(html, "input"), [
      "w-full",
      "min-w-0",
      "max-w-full",
      "box-border",
    ]);
  });

  it("date / time / datetime-local / number conservan el patrón", () => {
    for (const type of ["date", "time", "datetime-local", "number"] as const) {
      const html = renderToStaticMarkup(
        createElement(Input, {
          name: `campo-${type}`,
          type,
          label: type,
        }),
      );
      assert.match(html, new RegExp(`type="${type}"`));
      assertHasClassTokens(firstClassAttr(html, "input"), [
        "w-full",
        "min-w-0",
        "max-w-full",
        "box-border",
      ]);
      assertHasClassTokens(firstClassAttr(html, "div"), ["w-full", "min-w-0"]);
    }
  });

  it("conserva label, error y a11y", () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        name: "importe",
        label: "Importe",
        error: "Importe inválido",
        required: true,
      }),
    );
    assert.match(html, /<label\b[^>]*for="importe"/);
    assert.match(html, />Importe</);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /id="importe-error"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Importe inválido/);
    assert.match(html, /aria-describedby="importe-error"/);
  });

  it("API: className y containerClassName se fusionan sin perder el patrón", () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        name: "extra",
        className: "font-mono",
        containerClassName: "mt-2",
      }),
    );
    assertHasClassTokens(firstClassAttr(html, "div"), [
      "w-full",
      "min-w-0",
      "mt-2",
    ]);
    assertHasClassTokens(firstClassAttr(html, "input"), [
      "w-full",
      "min-w-0",
      "max-w-full",
      "font-mono",
    ]);
  });
});

describe("Select — patrón responsive (anti-overflow)", () => {
  it("contenedor y control con el mismo patrón que Input", () => {
    const html = renderToStaticMarkup(
      createElement(
        Select,
        { name: "estado", label: "Estado", defaultValue: "" },
        createElement("option", { value: "" }, "Todos"),
        createElement("option", { value: "EMITIDO" }, "Emitidos"),
      ),
    );
    assertHasClassTokens(firstClassAttr(html, "div"), ["w-full", "min-w-0"]);
    assertHasClassTokens(firstClassAttr(html, "select"), [
      "w-full",
      "min-w-0",
      "max-w-full",
      "box-border",
    ]);
    assert.match(html, /<label\b[^>]*for="estado"/);
    assert.match(html, /Emitidos/);
  });

  it("conserva error y a11y", () => {
    const html = renderToStaticMarkup(
      createElement(
        Select,
        {
          name: "accion",
          label: "Acción",
          error: "Seleccione una acción",
          required: true,
        },
        createElement("option", { value: "" }, "—"),
      ),
    );
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /id="accion-error"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Seleccione una acción/);
  });
});
