import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import {
  PLAIN_DEV_ABORT_MESSAGE,
  formatPlainDevBanner,
  preparePlainDevEnv,
} from "@/lib/dev/plain-dev-env";

const SECRET = "plain-dev-secret";

function neonUrl(endpoint: string, pooler = false): string {
  const host = pooler
    ? `${endpoint}-pooler.c-6.us-east-2.aws.neon.tech`
    : `${endpoint}.c-6.us-east-2.aws.neon.tech`;
  return `postgresql://u:${SECRET}@${host}/neondb`;
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
}

describe("preparePlainDevEnv", () => {
  it("rechaza producción", () => {
    const r = preparePlainDevEnv({
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION, true),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /abortó|prohibido|ep-spring-silence/);
      assertNoSecrets(r.reason);
    }
  });

  it("rechaza recovery original", () => {
    const r = preparePlainDevEnv({
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.RECOVERY, true),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.RECOVERY),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /abortó|prohibido|ep-old-snow/);
  });

  it("acepta desarrollo recuperado y fuerza URLs en el hijo", () => {
    const pooled = neonUrl(NEON_ENDPOINTS.DEV_RECOVERY, true);
    const direct = neonUrl(NEON_ENDPOINTS.DEV_RECOVERY);
    const parent = {
      DATABASE_URL: pooled,
      DIRECT_URL: direct,
      PATH: "/usr/bin",
    };
    const r = preparePlainDevEnv(parent);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.endpointId, NEON_ENDPOINTS.DEV_RECOVERY);
    assert.equal(r.childEnv.DATABASE_URL, pooled);
    assert.equal(r.childEnv.DIRECT_URL, direct);
  });

  it("acepta TEST autorizado", () => {
    const r = preparePlainDevEnv({
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST, true),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.endpointId, NEON_ENDPOINTS.TEST);
  });

  it("rechaza destino desconocido", () => {
    const r = preparePlainDevEnv({
      DATABASE_URL: neonUrl("ep-other-branch-x1234567", true),
      DIRECT_URL: neonUrl("ep-other-branch-x1234567"),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /desconocido|abortó/);
      assert.match(r.reason, /dev:recovery/);
    }
  });

  it("rechaza variables ausentes", () => {
    const r = preparePlainDevEnv({ DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /faltan DATABASE_URL/);
  });

  it("rechaza discrepancia DATABASE vs DIRECT (Next no vería un único destino)", () => {
    const r = preparePlainDevEnv({
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY, true),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /no comparten endpoint/);
      assert.ok(r.reason.startsWith(PLAIN_DEV_ABORT_MESSAGE.slice(0, 20)));
    }
  });

  it("banner sin secretos", () => {
    const banner = formatPlainDevBanner(NEON_ENDPOINTS.DEV_RECOVERY);
    assert.match(banner, /SAFE LOCAL DEV/);
    assertNoSecrets(banner);
  });
});
