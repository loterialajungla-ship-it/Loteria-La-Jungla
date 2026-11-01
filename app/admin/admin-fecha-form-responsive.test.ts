import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("admin/page — formulario fecha responsive (D.3.B)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/admin/page.tsx"),
    "utf8",
  );

  it("conserva Input date, label y botón Ver fecha", () => {
    assert.match(src, /type="date"/);
    assert.match(src, /name="fecha"/);
    assert.match(src, /label="Fecha de trabajo"/);
    assert.match(src, /defaultValue=\{fechaStr\}/);
    assert.match(src, />\s*Ver fecha\s*</);
    assert.match(src, /method="get"/);
  });

  it("form flex con min-w-0; Input container min-w-0 flex-1; botón shrink-0", () => {
    assert.match(
      src,
      /className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end"/,
    );
    assert.match(src, /containerClassName="min-w-0 flex-1"/);
    assert.match(src, /className="shrink-0 sm:min-w-\[8\.5rem\]"/);
  });

  it("no introduce overflow-x-hidden como parche", () => {
    assert.equal(src.includes("overflow-x-hidden"), false);
  });
});
