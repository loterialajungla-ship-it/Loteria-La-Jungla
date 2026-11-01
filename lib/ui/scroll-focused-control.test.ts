import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  isFullyVisibleInViewport,
  readVisibleViewportBox,
  shouldScrollFocusedControlIntoView,
} from "@/lib/ui/scroll-focused-control";

describe("scrollFocusedControlIntoView — visibilidad (D.3.H / G-05)", () => {
  it("no recomienda scroll si el control ya está enteramente visible", () => {
    const el = { top: 100, bottom: 140, left: 10, right: 200 };
    const vp = { top: 0, bottom: 800, left: 0, right: 400 };
    assert.equal(isFullyVisibleInViewport(el, vp), true);
    assert.equal(shouldScrollFocusedControlIntoView(el, vp), false);
  });

  it("recomienda scroll si el control queda bajo el borde inferior (p. ej. teclado)", () => {
    // visualViewport reducido: visible 0–400; control en 380–440
    const el = { top: 380, bottom: 440, left: 10, right: 200 };
    const vp = readVisibleViewportBox(400, 800, {
      height: 400,
      offsetTop: 0,
      width: 400,
    });
    assert.equal(vp.bottom, 400);
    assert.equal(isFullyVisibleInViewport(el, vp), false);
    assert.equal(shouldScrollFocusedControlIntoView(el, vp), true);
  });

  it("recomienda scroll si el control queda por encima del viewport visible", () => {
    const el = { top: -20, bottom: 20, left: 0, right: 100 };
    const vp = { top: 0, bottom: 600, left: 0, right: 375 };
    assert.equal(shouldScrollFocusedControlIntoView(el, vp), true);
  });

  it("sin visualViewport usa layout completo (innerHeight)", () => {
    const vp = readVisibleViewportBox(390, 844, null);
    assert.deepEqual(vp, { top: 0, bottom: 844, left: 0, right: 390 });
  });

  it("POS usa el helper condicional; no llama scrollIntoView a ciegas", () => {
    const root = path.resolve(__dirname, "../..");
    const grid = fs.readFileSync(
      path.join(root, "components/tickets/AnimalGrid.tsx"),
      "utf8",
    );
    const summary = fs.readFileSync(
      path.join(root, "components/tickets/TicketSummary.tsx"),
      "utf8",
    );
    assert.match(grid, /scrollFocusedControlIntoView/);
    assert.match(summary, /scrollFocusedControlIntoView/);
    assert.doesNotMatch(grid, /scrollIntoView\(\s*\{/);
    assert.doesNotMatch(summary, /scrollIntoView\(\s*\{/);
  });
});
