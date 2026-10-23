import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import {
  assertPrismaProcessEnvAllowed,
  isDbSuiteProcess,
} from "@/lib/db/prisma-process-guard";

/** Placeholder de tests — no es credencial real. */
const SECRET = "prisma-process-guard-secret";

function neonUrl(endpoint: string, pooler = false): string {
  const host = pooler
    ? `${endpoint}-pooler.c-6.us-east-2.aws.neon.tech`
    : `${endpoint}.c-6.us-east-2.aws.neon.tech`;
  return `postgresql://u:${SECRET}@${host}/neondb`;
}

describe("prisma-process-guard", () => {
  const testEnv = {
    TEST_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST, true),
    DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
    DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
  };

  it("isDbSuiteProcess solo con flags de suite", () => {
    assert.equal(isDbSuiteProcess({}), false);
    assert.equal(isDbSuiteProcess({ RUN_INTEGRATION: "1" }), true);
    assert.equal(isDbSuiteProcess({ RUN_ACCEPTANCE: "1" }), true);
    assert.equal(isDbSuiteProcess({ RUN_INTEGRATION: "0" }), false);
  });

  it("sin flag de suite: no-op aunque DATABASE sea producción", () => {
    assert.doesNotThrow(() =>
      assertPrismaProcessEnvAllowed({
        DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        DIRECT_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
      }),
    );
  });

  it("RUN_INTEGRATION=1 exige destino TEST allowlisted", () => {
    assert.doesNotThrow(() =>
      assertPrismaProcessEnvAllowed({
        ...testEnv,
        RUN_INTEGRATION: "1",
      }),
    );
  });

  it("RUN_INTEGRATION=1 + DATABASE producción → rechaza", () => {
    assert.throws(
      () =>
        assertPrismaProcessEnvAllowed({
          RUN_INTEGRATION: "1",
          TEST_DATABASE_URL: testEnv.TEST_DATABASE_URL,
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      /prohibido|DATABASE_URL|TEST|ep-spring-silence/,
    );
  });

  it("RUN_INTEGRATION=1 sin TEST_DATABASE_URL → rechaza (no fallback)", () => {
    assert.throws(
      () =>
        assertPrismaProcessEnvAllowed({
          RUN_INTEGRATION: "1",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      /TEST_DATABASE_URL/,
    );
  });

  it("RUN_ACCEPTANCE=1 sin TEST → rechaza", () => {
    assert.throws(
      () =>
        assertPrismaProcessEnvAllowed({
          RUN_ACCEPTANCE: "1",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /TEST_DATABASE_URL/,
    );
  });

  it("solo RUN_INTEGRATION=1 sin URLs → rechaza", () => {
    assert.throws(
      () => assertPrismaProcessEnvAllowed({ RUN_INTEGRATION: "1" }),
      /TEST_DATABASE_URL/,
    );
  });
});
