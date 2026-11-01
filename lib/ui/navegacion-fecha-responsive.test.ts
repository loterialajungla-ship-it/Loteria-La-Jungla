import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function assertHasClassTokens(classAttr: string, tokens: string[]) {
  const set = new Set(classAttr.split(/\s+/).filter(Boolean));
  for (const token of tokens) {
    assert.ok(
      set.has(token),
      `falta clase "${token}" en class="${classAttr}"`,
    );
  }
}

function extractInputDateClass(src: string): string {
  const m = src.match(/type="date"[\s\S]*?className="([^"]+)"/);
  assert.ok(m?.[1], "no se encontró className del input date en NavegacionFecha");
  return m[1];
}

describe("NavegacionFecha — patrón responsive (D.3.B)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "components/NavegacionFecha.tsx"),
    "utf8",
  );

  it("conserva type=date, name=fecha, max y defaultValue", () => {
    assert.match(src, /type="date"/);
    assert.match(src, /name="fecha"/);
    assert.match(src, /defaultValue=\{fechaStr\}/);
    assert.match(src, /max=\{maxFecha\}/);
    assert.match(src, /method="get"/);
    assert.match(src, /action="\/"/);
  });

  it("form y label permiten encogerse (w-full min-w-0)", () => {
    assert.match(src, /className="mt-3 w-full min-w-0"/);
    assert.match(
      src,
      /className="flex w-full min-w-0 flex-col gap-2 text-sm font-medium text-emerald-300"/,
    );
  });

  it("input date: box-border w-full min-w-0 max-w-full", () => {
    const cls = extractInputDateClass(src);
    assertHasClassTokens(cls, [
      "box-border",
      "w-full",
      "min-w-0",
      "max-w-full",
    ]);
  });

  it("no sustituye el control nativo ni introduce overflow-x-hidden", () => {
    assert.equal(src.includes("overflow-x-hidden"), false);
    assert.equal(src.includes("<Input"), false);
    assert.match(src, /<input\b/);
  });
});
