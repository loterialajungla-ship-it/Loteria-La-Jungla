import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";

/** Placeholder de tests unitarios — no es una credencial real. */
const SECRET = "assert-int-secret";

function neonUrl(endpoint: string, pooler = false): string {
  const host = pooler
    ? `${endpoint}-pooler.c-6.us-east-2.aws.neon.tech`
    : `${endpoint}.c-6.us-east-2.aws.neon.tech`;
  return `postgresql://u:${SECRET}@${host}/neondb`;
}

describe("assertIntegrationPointsAtTestDatabase", () => {
  const testUrl = neonUrl(NEON_ENDPOINTS.TEST, true);
  const testDirect = neonUrl(NEON_ENDPOINTS.TEST, false);
  const prodUrl = neonUrl(NEON_ENDPOINTS.PRODUCTION, true);
  const prodDirect = neonUrl(NEON_ENDPOINTS.PRODUCTION, false);

  it("acepta DATABASE_URL = TEST (pooler), como inyección del runner", () => {
    assert.equal(
      assertIntegrationPointsAtTestDatabase({
        TEST_DATABASE_URL: testUrl,
        DATABASE_URL: testUrl,
        DIRECT_URL: testDirect,
      }),
      NEON_ENDPOINTS.TEST,
    );
  });

  it("acepta DATABASE_URL = host directo derivado de TEST", () => {
    assert.equal(
      assertIntegrationPointsAtTestDatabase({
        TEST_DATABASE_URL: testUrl,
        DATABASE_URL: testDirect,
        DIRECT_URL: testDirect,
      }),
      NEON_ENDPOINTS.TEST,
    );
  });

  it("rechaza DATABASE_URL de producción", () => {
    assert.throws(
      () =>
        assertIntegrationPointsAtTestDatabase({
          TEST_DATABASE_URL: testUrl,
          DATABASE_URL: prodUrl,
          DIRECT_URL: prodDirect,
        }),
      /prohibido|DATABASE_URL|ep-spring-silence/,
    );
  });

  it("rechaza si DATABASE_URL es el DIRECT de producción", () => {
    assert.throws(
      () =>
        assertIntegrationPointsAtTestDatabase({
          TEST_DATABASE_URL: testUrl,
          DATABASE_URL: prodDirect,
          DIRECT_URL: prodDirect,
        }),
      /prohibido|DATABASE_URL|ep-spring-silence/,
    );
  });

  it("rechaza desarrollo recuperado aunque TEST=DATABASE", () => {
    const recoveryDev = neonUrl(NEON_ENDPOINTS.DEV_RECOVERY, true);
    assert.throws(
      () =>
        assertIntegrationPointsAtTestDatabase({
          TEST_DATABASE_URL: recoveryDev,
          DATABASE_URL: recoveryDev,
        }),
      /prohibido|TEST|ep-delicate-river/,
    );
  });
});
