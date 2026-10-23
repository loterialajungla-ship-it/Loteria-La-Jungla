import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import { checkSafeTestDatabase } from "@/lib/tickets/integration/safe-test-db";

const TEST_URL = `postgresql://u:p@${NEON_ENDPOINTS.TEST}-pooler.c-6.us-east-2.aws.neon.tech/neondb`;
const PROD_URL = `postgresql://u:p@${NEON_ENDPOINTS.PRODUCTION}-pooler.c-6.us-east-2.aws.neon.tech/neondb`;
const PROD_DIRECT = `postgresql://u:p@${NEON_ENDPOINTS.PRODUCTION}.c-6.us-east-2.aws.neon.tech/neondb`;

describe("checkSafeTestDatabase", () => {
  it("rechaza sin TEST_DATABASE_URL", () => {
    const r = checkSafeTestDatabase({
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT,
    });
    assert.equal(r.ok, false);
  });

  it("rechaza si TEST_DATABASE_URL === DATABASE_URL", () => {
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: TEST_URL,
      DATABASE_URL: TEST_URL,
      DIRECT_URL: PROD_DIRECT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /aislada de producción/);
    }
  });

  it("rechaza si TEST_DATABASE_URL === DIRECT_URL", () => {
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: TEST_URL,
      DATABASE_URL: PROD_URL,
      DIRECT_URL: TEST_URL,
    });
    assert.equal(r.ok, false);
  });

  it("acepta URL de test distinta de prod", () => {
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: TEST_URL,
      DATABASE_URL: PROD_URL,
      DIRECT_URL: PROD_DIRECT,
    });
    assert.equal(r.ok, true);
  });

  it("rechaza TEST apuntando a producción", () => {
    const r = checkSafeTestDatabase({
      TEST_DATABASE_URL: PROD_URL,
      DATABASE_URL: `postgresql://u:p@other.c-6.us-east-2.aws.neon.tech/neondb`,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /prohibido|TEST/);
    }
  });
});
