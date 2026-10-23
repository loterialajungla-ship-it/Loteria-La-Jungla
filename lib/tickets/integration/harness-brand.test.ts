import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import {
  INTEGRATION_PRISMA_BRAND,
  assertIntegrationPrismaClient,
} from "@/lib/tickets/integration/harness";

const SECRET = "harness-brand-secret";

function neonUrl(endpoint: string, pooler = false): string {
  const host = pooler
    ? `${endpoint}-pooler.c-6.us-east-2.aws.neon.tech`
    : `${endpoint}.c-6.us-east-2.aws.neon.tech`;
  return `postgresql://u:${SECRET}@${host}/neondb`;
}

describe("assertIntegrationPrismaClient (sin Prisma real)", () => {
  const testEnv = {
    TEST_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST, true),
    DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
    DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
  };

  it("rechaza cliente sin marca de fábrica (simula @/lib/prisma u override opaco)", () => {
    const opaque = {} as PrismaClient;
    assert.throws(
      () => assertIntegrationPrismaClient(opaque, testEnv),
      /no está verificado|createIntegrationPrismaClient/,
    );
  });

  it("rechaza cliente con marca falsa / endpoint incorrecto", () => {
    const fake = {
      [INTEGRATION_PRISMA_BRAND]: NEON_ENDPOINTS.PRODUCTION,
    } as unknown as PrismaClient;
    assert.throws(
      () => assertIntegrationPrismaClient(fake, testEnv),
      /no está verificado|createIntegrationPrismaClient/,
    );
  });

  it("acepta marca TEST alineada con el entorno", () => {
    const branded = {
      [INTEGRATION_PRISMA_BRAND]: NEON_ENDPOINTS.TEST,
    } as unknown as PrismaClient;
    assert.doesNotThrow(() =>
      assertIntegrationPrismaClient(branded, testEnv),
    );
  });

  it("rechaza marca TEST si el entorno apunta a producción", () => {
    const branded = {
      [INTEGRATION_PRISMA_BRAND]: NEON_ENDPOINTS.TEST,
    } as unknown as PrismaClient;
    assert.throws(
      () =>
        assertIntegrationPrismaClient(branded, {
          TEST_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST, true),
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /DATABASE_URL|prohibido|ep-spring-silence/,
    );
  });
});
