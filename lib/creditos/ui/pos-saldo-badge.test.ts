import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PosSaldoBadge } from "@/components/creditos/PosSaldoBadge";
import type { PosSaldoViewModel } from "@/lib/creditos/ui/mi-cuenta-saldo-model";

function vm(partial: Partial<PosSaldoViewModel> & Pick<PosSaldoViewModel, "kind" | "primary">): PosSaldoViewModel {
  return {
    secondary: null,
    showSaldoBajo: false,
    stale: false,
    error: null,
    canRetry: false,
    busy: false,
    updating: false,
    ...partial,
  };
}

describe("PosSaldoBadge", () => {
  it("renderiza saldo disponible", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({ kind: "saldo", primary: "Tu saldo: 15.00" }),
      }),
    );
    assert.match(html, /data-pos-saldo-kind="saldo"/);
    assert.match(html, /Tu saldo/);
    assert.match(html, /15\.00/);
  });

  it("renderiza control inactivo", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "control_inactivo",
          primary: "Control de créditos inactivo · Saldo informativo",
          secondary: "Saldo informativo: 5.00",
        }),
      }),
    );
    assert.match(html, /data-pos-saldo-kind="control_inactivo"/);
    assert.match(html, /inactivo/i);
  });

  it("renderiza configuración no inicializada", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "config_ausente",
          primary: "Estado de créditos no configurado",
        }),
      }),
    );
    assert.match(html, /data-pos-saldo-kind="config_ausente"/);
    assert.match(html, /no configurado/i);
  });

  it("renderiza sin cuenta", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "sin_cuenta",
          primary: "Sin cuenta de créditos",
          secondary: "Aún no tienes una cuenta de saldo asignada.",
        }),
      }),
    );
    assert.match(html, /data-pos-saldo-kind="sin_cuenta"/);
    assert.match(html, /Sin cuenta/);
  });

  it("muestra badge saldo bajo solo cuando showSaldoBajo", () => {
    const con = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 1.00",
          showSaldoBajo: true,
        }),
      }),
    );
    assert.match(con, /Saldo bajo/);
    const sin = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 1.00",
          showSaldoBajo: false,
        }),
      }),
    );
    assert.equal(/Saldo bajo/.test(sin), false);
  });

  it("muestra stale y reintentar", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 3.00",
          stale: true,
          error: "Error de red al consultar el saldo.",
          canRetry: true,
        }),
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /desactualizados/i);
    assert.match(html, /Reintentar/);
  });

  it("estado error con reintentar", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "error",
          primary: "Saldo no disponible",
          error: "No se pudo consultar el saldo.",
          canRetry: true,
        }),
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /data-pos-saldo-kind="error"/);
    assert.match(html, /Reintentar/);
    assert.match(html, /role="status"/);
  });

  it("refresco con data previa: saldo visible + Actualizando + aria-busy", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 42.50",
          busy: true,
          updating: true,
        }),
      }),
    );
    assert.match(html, /42\.50/);
    assert.match(html, /Actualizando saldo/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /data-pos-saldo-updating="true"/);
    // No aria-live en el contenedor raíz (evita releer el saldo entero).
    assert.equal(/data-testid="pos-saldo-badge"[^>]*aria-live/.test(html), false);
  });

  it("durante updating no muestra stale ni error aunque vinieran del view previo", () => {
    // El view-model ya debe limpiarlos; el badge no debe inventarlos.
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 42.50",
          busy: true,
          updating: true,
          stale: false,
          error: null,
          canRetry: false,
        }),
      }),
    );
    assert.match(html, /Actualizando saldo/);
    assert.equal(/desactualizados/i.test(html), false);
    assert.equal(/Error de red/i.test(html), false);
    assert.equal(/Reintentar/.test(html), false);
  });

  it("stale tras fallo de refresco conserva saldo e indica desactualizado", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "saldo",
          primary: "Tu saldo: 42.50",
          stale: true,
          error: "Error de red al consultar el saldo.",
          canRetry: true,
        }),
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /42\.50/);
    assert.match(html, /desactualizados/i);
    assert.match(html, /Error de red/);
    assert.match(html, /Reintentar/);
    assert.equal(/Actualizando saldo/.test(html), false);
  });

  it("carga inicial sin data: Consultando + aria-busy", () => {
    const html = renderToStaticMarkup(
      createElement(PosSaldoBadge, {
        view: vm({
          kind: "loading",
          primary: "Consultando saldo…",
          busy: true,
          updating: false,
        }),
      }),
    );
    assert.match(html, /Consultando saldo/);
    assert.match(html, /aria-busy="true"/);
    assert.equal(/Actualizando saldo/.test(html), false);
  });
});
