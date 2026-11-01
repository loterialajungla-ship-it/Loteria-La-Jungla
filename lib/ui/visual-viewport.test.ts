import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readVisualViewportMetrics,
  visualViewportBottomInset,
  visualViewportPanelMaxHeightPx,
} from "@/lib/ui/visual-viewport";

describe("visualViewportBottomInset (D.3.E)", () => {
  it("devuelve 0 sin visualViewport o con alturas inválidas", () => {
    assert.equal(visualViewportBottomInset(800, null), 0);
    assert.equal(visualViewportBottomInset(800, undefined), 0);
    assert.equal(visualViewportBottomInset(0, { height: 400, offsetTop: 0 }), 0);
    assert.equal(visualViewportBottomInset(800, { height: 0, offsetTop: 0 }), 0);
  });

  it("calcula el inset cuando el teclado reduce la altura visible", () => {
    // layout 800; visual 500 anclado arriba → 300 ocultos abajo (teclado)
    assert.equal(
      visualViewportBottomInset(800, { height: 500, offsetTop: 0 }),
      300,
    );
  });

  it("restablece inset 0 cuando visual ≈ layout (teclado cerrado)", () => {
    assert.equal(
      visualViewportBottomInset(667, { height: 667, offsetTop: 0 }),
      0,
    );
  });

  it("compensa offsetTop del visualViewport (p. ej. scroll de URL bar)", () => {
    // innerHeight 800; visual height 500 offsetTop 50 → 800-500-50 = 250
    assert.equal(
      visualViewportBottomInset(800, { height: 500, offsetTop: 50 }),
      250,
    );
  });

  it("nunca devuelve negativo", () => {
    assert.equal(
      visualViewportBottomInset(400, { height: 500, offsetTop: 0 }),
      0,
    );
  });
});

describe("visualViewportPanelMaxHeightPx (D.3.E)", () => {
  it("null sin altura usable; respeta fracción y mínimo", () => {
    assert.equal(visualViewportPanelMaxHeightPx(null), null);
    assert.equal(visualViewportPanelMaxHeightPx(0), null);
    assert.equal(visualViewportPanelMaxHeightPx(400, 0.5), 200);
    assert.equal(visualViewportPanelMaxHeightPx(100, 0.5, 120), 120);
  });
});

describe("readVisualViewportMetrics (D.3.E)", () => {
  it("combina inset y max-height para layout reducido", () => {
    const m = readVisualViewportMetrics(
      844,
      { height: 420, offsetTop: 0 },
      0.48,
    );
    assert.equal(m.bottomInset, 424);
    assert.equal(m.panelMaxHeightPx, Math.round(420 * 0.48));
  });

  it("sin visual: inset 0 y panel null (CSS de respaldo)", () => {
    const m = readVisualViewportMetrics(800, null, 0.48);
    assert.equal(m.bottomInset, 0);
    assert.equal(m.panelMaxHeightPx, null);
  });
});
