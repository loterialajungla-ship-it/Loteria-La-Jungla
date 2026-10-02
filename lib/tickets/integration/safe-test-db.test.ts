import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSafeTestDatabase } from "@/lib/tickets/integration/safe-test-db";

describe("checkSafeTestDatabase", () => {
  it("rechaza sin TEST_DATABASE_URL", () => {
    const r = checkSafeTestDatabase({
      DATABASE_URL: "postgresql://u:p@host/prod",
      DIRECT_URL: "postgresql://u:p@host/prod",
    });
    assert.equal(r.ok, false);
  });

  it("rechaza si TEST_DATABASE_URL === DATABASE_URL", () => {
    const url = "postgresql://u:p@host/neondb";
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: url,
      DATABASE_URL: url,
      DIRECT_URL: "postgresql://u:p@host/other",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /aislada de producción/);
    }
  });

  it("rechaza si TEST_DATABASE_URL === DIRECT_URL", () => {
    const url = "postgresql://u:p@host/neondb";
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: url,
      DATABASE_URL: "postgresql://u:p@pooler/neondb",
      DIRECT_URL: url,
    });
    assert.equal(r.ok, false);
  });

  it("acepta URL de test distinta", () => {
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/llj_test",
      DATABASE_URL: "postgresql://u:p@neon-pooler/neondb",
      DIRECT_URL: "postgresql://u:p@neon/neondb",
    });
    assert.equal(r.ok, true);
  });
});
