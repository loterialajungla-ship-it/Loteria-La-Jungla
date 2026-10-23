import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  UNIT_TEST_ROOTS,
  buildUnitTestChildEnv,
  isExcludedUnitTestFileName,
  isUnitTestFileName,
  listUnitTestFiles,
} from "@/lib/dev/unit-test-file-list";

describe("unit-test-file-list", () => {
  it("excluye integration y acceptance por sufijo", () => {
    assert.equal(isUnitTestFileName("save-manual.test.ts"), true);
    assert.equal(isUnitTestFileName("cron-auth.test.ts"), true);
    assert.equal(
      isUnitTestFileName("auto-publish.integration.test.ts"),
      false,
    );
    assert.equal(
      isExcludedUnitTestFileName("auto-publish.integration.test.ts"),
      true,
    );
    assert.equal(
      isUnitTestFileName("auth-tickets.acceptance.test.ts"),
      false,
    );
  });

  it("no enumera *.integration.test.ts aunque existan untracked en disco", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llj-unit-list-"));
    try {
      const resultados = path.join(tmp, "lib", "resultados");
      fs.mkdirSync(resultados, { recursive: true });
      fs.writeFileSync(path.join(resultados, "cron-auth.test.ts"), "");
      fs.writeFileSync(
        path.join(resultados, "auto-publish.integration.test.ts"),
        "",
      );
      const integration = path.join(tmp, "lib", "tickets", "integration");
      fs.mkdirSync(integration, { recursive: true });
      fs.writeFileSync(path.join(integration, "safe-test-db.test.ts"), "");
      fs.writeFileSync(
        path.join(integration, "create-ticket.integration.test.ts"),
        "",
      );

      const listed = listUnitTestFiles(tmp).map((f) =>
        path.relative(tmp, f).split(path.sep).join("/"),
      );
      assert.deepEqual(listed, [
        "lib/resultados/cron-auth.test.ts",
        "lib/tickets/integration/safe-test-db.test.ts",
      ]);
      assert.ok(
        listed.every((f) => !f.endsWith(".integration.test.ts")),
        "ningún integration en inventario",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("buildUnitTestChildEnv elimina URLs y flags de integración", () => {
    const child = buildUnitTestChildEnv({
      PATH: "/usr/bin",
      DATABASE_URL: "postgresql://should-not-leak/db",
      DIRECT_URL: "postgresql://should-not-leak/db",
      TEST_DATABASE_URL: "postgresql://should-not-leak/test",
      RUN_INTEGRATION: "1",
      RUN_ACCEPTANCE: "1",
      NODE_ENV: "test",
    });
    assert.equal(child.PATH, "/usr/bin");
    assert.equal(child.NODE_ENV, "test");
    assert.equal(child.DATABASE_URL, undefined);
    assert.equal(child.DIRECT_URL, undefined);
    assert.equal(child.TEST_DATABASE_URL, undefined);
    assert.equal(child.RUN_INTEGRATION, undefined);
    assert.equal(child.RUN_ACCEPTANCE, undefined);
  });

  it("UNIT_TEST_ROOTS cubre G0/A/B/D-E sin lib/acceptance", () => {
    const dirs = UNIT_TEST_ROOTS.map((r) =>
      r.relativeDir.split(path.sep).join("/"),
    );
    assert.ok(dirs.includes("lib/db"));
    assert.ok(dirs.includes("lib/resultados"));
    assert.ok(dirs.includes("lib/dev"));
    assert.ok(dirs.includes("app/admin"));
    assert.ok(!dirs.some((d) => d.startsWith("lib/acceptance")));
  });
});
