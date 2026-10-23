import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEON_ENDPOINTS,
  CONFIRM_PRODUCTION_BOOTSTRAP_VALUE,
  assertDevRecoveryBootstrapTarget,
  assertEndpointNotForbidden,
  assertIntegrationWriteTarget,
  assertPrismaSeedAllowed,
  assertProductionBootstrapTarget,
  assertTestDatabaseUrlAuthorized,
  extractNeonEndpointId,
} from "@/lib/db/neon-endpoint-guard";


const SECRET = "unit-test-secret-never-log";

function neonUrl(
  endpoint: string,
  opts?: { pooler?: boolean; user?: string },
): string {
  const user = opts?.user ?? "neondb_owner";
  const host = opts?.pooler
    ? `${endpoint}-pooler.c-6.us-east-2.aws.neon.tech`
    : `${endpoint}.c-6.us-east-2.aws.neon.tech`;
  return `postgresql://${user}:${SECRET}@${host}/neondb?sslmode=require`;
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
  assert.doesNotMatch(text, /neondb_owner/i);
  assert.doesNotMatch(text, /sslmode/i);
  assert.doesNotMatch(text, /:\/\/[^/\s]+@/i);
}

describe("extractNeonEndpointId", () => {
  it("URL vacía", () => {
    const r = extractNeonEndpointId("");
    assert.equal(r.ok, false);
    if (!r.ok) assertNoSecrets(r.reason);
  });

  it("URL malformada", () => {
    const r = extractNeonEndpointId("postgresql://");
    assert.equal(r.ok, false);
    if (!r.ok) assertNoSecrets(r.reason);
  });

  it("host no Neon / no reconocido", () => {
    const r = extractNeonEndpointId(
      `postgresql://u:${SECRET}@localhost:5432/llj_test`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /neon\.tech|reconocido/i);
      assertNoSecrets(r.reason);
    }
  });

  it("rechaza subdominio anidado engañoso en neon.tech", () => {
    const r = extractNeonEndpointId(
      `postgresql://u:${SECRET}@${NEON_ENDPOINTS.TEST}.evil.neon.tech/neondb`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /no reconocido|Host Neon/);
  });

  it("rechaza ep- engañoso fuera del patrón aws.neon.tech", () => {
    const r = extractNeonEndpointId(
      `postgresql://u:${SECRET}@${NEON_ENDPOINTS.TEST}.example.com/neondb`,
    );
    assert.equal(r.ok, false);
  });

  it("rechaza host con etiquetas extra antes de aws.neon.tech", () => {
    const r = extractNeonEndpointId(
      `postgresql://u:${SECRET}@${NEON_ENDPOINTS.TEST}.extra.c-6.us-east-2.aws.neon.tech/neondb`,
    );
    assert.equal(r.ok, false);
  });

  it("pooler y directa del mismo endpoint", () => {
    const p = extractNeonEndpointId(
      neonUrl(NEON_ENDPOINTS.TEST, { pooler: true }),
    );
    const d = extractNeonEndpointId(neonUrl(NEON_ENDPOINTS.TEST));
    assert.equal(p.ok, true);
    assert.equal(d.ok, true);
    if (!p.ok || !d.ok) return;
    assert.equal(p.endpointId, NEON_ENDPOINTS.TEST);
    assert.equal(d.endpointId, NEON_ENDPOINTS.TEST);
    assert.equal(p.hasPoolerSuffix, true);
    assert.equal(d.hasPoolerSuffix, false);
  });

  it("normaliza mayúsculas en el host", () => {
    const upper = `postgresql://u:${SECRET}@EP-MUDDY-FIRE-B44816W0.C-6.US-EAST-2.AWS.NEON.TECH/neondb`;
    const r = extractNeonEndpointId(upper);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.endpointId, NEON_ENDPOINTS.TEST);
  });
});

describe("assertEndpointNotForbidden", () => {
  it("rechaza producción", () => {
    assert.throws(
      () =>
        assertEndpointNotForbidden(
          neonUrl(NEON_ENDPOINTS.PRODUCTION),
          "integration-write",
        ),
      /prohibido|ep-spring-silence/,
    );
  });

  it("rechaza recuperación original", () => {
    assert.throws(
      () =>
        assertEndpointNotForbidden(
          neonUrl(NEON_ENDPOINTS.RECOVERY),
          "any-non-forbidden",
        ),
      /prohibido|ep-old-snow/,
    );
  });

  it("rechaza desarrollo recuperado en integración", () => {
    assert.throws(
      () =>
        assertEndpointNotForbidden(
          neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
          "integration-write",
        ),
      /prohibido|ep-delicate-river/,
    );
  });

  it("acepta TEST autorizado en integration-write", () => {
    const id = assertEndpointNotForbidden(
      neonUrl(NEON_ENDPOINTS.TEST, { pooler: true }),
      "integration-write",
    );
    assert.equal(id, NEON_ENDPOINTS.TEST);
  });

  it("rechaza endpoint distinto de TEST en integration-write", () => {
    assert.throws(
      () =>
        assertEndpointNotForbidden(
          neonUrl("ep-other-branch-x1234567"),
          "integration-write",
        ),
      /TEST autorizado|ep-muddy-fire/,
    );
  });
});

describe("assertIntegrationWriteTarget", () => {
  const testPooled = neonUrl(NEON_ENDPOINTS.TEST, { pooler: true });
  const testDirect = neonUrl(NEON_ENDPOINTS.TEST);
  const prod = neonUrl(NEON_ENDPOINTS.PRODUCTION);
  const recovery = neonUrl(NEON_ENDPOINTS.RECOVERY);
  const devRec = neonUrl(NEON_ENDPOINTS.DEV_RECOVERY);

  it("variables obligatorias ausentes", () => {
    assert.throws(
      () => assertIntegrationWriteTarget({ DATABASE_URL: testDirect }),
      /TEST_DATABASE_URL/,
    );
    assert.throws(
      () => assertIntegrationWriteTarget({ TEST_DATABASE_URL: testPooled }),
      /DATABASE_URL/,
    );
  });

  it("éxito pooler + directa TEST", () => {
    const r = assertIntegrationWriteTarget({
      TEST_DATABASE_URL: testPooled,
      DATABASE_URL: testDirect,
      DIRECT_URL: testDirect,
    });
    assert.equal(r.testEndpointId, NEON_ENDPOINTS.TEST);
    assert.equal(r.databaseEndpointId, NEON_ENDPOINTS.TEST);
    assert.equal(r.directEndpointId, NEON_ENDPOINTS.TEST);
  });

  it("DATABASE_URL producción con TEST correcto → rechazo", () => {
    assert.throws(
      () =>
        assertIntegrationWriteTarget({
          TEST_DATABASE_URL: testPooled,
          DATABASE_URL: prod,
          DIRECT_URL: testDirect,
        }),
      /DATABASE_URL|prohibido|ep-spring-silence/,
    );
  });

  it("DIRECT_URL producción con resto TEST → rechazo", () => {
    assert.throws(
      () =>
        assertIntegrationWriteTarget({
          TEST_DATABASE_URL: testPooled,
          DATABASE_URL: testDirect,
          DIRECT_URL: prod,
        }),
      /DIRECT_URL|prohibido|ep-spring-silence/,
    );
  });

  it("rechaza recovery y dev-recovery aunque las URLs coincidan entre sí", () => {
    assert.throws(
      () =>
        assertIntegrationWriteTarget({
          TEST_DATABASE_URL: recovery,
          DATABASE_URL: recovery,
          DIRECT_URL: recovery,
        }),
      /prohibido|ep-old-snow|TEST/,
    );
    assert.throws(
      () =>
        assertIntegrationWriteTarget({
          TEST_DATABASE_URL: devRec,
          DATABASE_URL: devRec,
        }),
      /prohibido|ep-delicate-river|TEST/,
    );
  });

  it("mensajes sin secretos", () => {
    try {
      assertIntegrationWriteTarget({
        TEST_DATABASE_URL: testPooled,
        DATABASE_URL: prod,
      });
      assert.fail("expected throw");
    } catch (e) {
      assertNoSecrets(e instanceof Error ? e.message : String(e));
    }
  });
});

describe("assertTestDatabaseUrlAuthorized", () => {
  it("acepta TEST", () => {
    assert.equal(
      assertTestDatabaseUrlAuthorized(neonUrl(NEON_ENDPOINTS.TEST)),
      NEON_ENDPOINTS.TEST,
    );
  });

  it("rechaza producción", () => {
    assert.throws(
      () =>
        assertTestDatabaseUrlAuthorized(neonUrl(NEON_ENDPOINTS.PRODUCTION)),
      /prohibido|TEST/,
    );
  });
});

describe("assertPrismaSeedAllowed", () => {
  it("rechaza sin PRISMA_SEED_TARGET", () => {
    assert.throws(
      () =>
        assertPrismaSeedAllowed({
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /PRISMA_SEED_TARGET|autorización/,
    );
  });

  it("rechaza producción aunque el target sea test", () => {
    assert.throws(
      () =>
        assertPrismaSeedAllowed({
          PRISMA_SEED_TARGET: "test",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      /prohibido|TEST|ep-spring-silence/,
    );
  });

  it("rechaza desarrollo recuperado", () => {
    assert.throws(
      () =>
        assertPrismaSeedAllowed({
          PRISMA_SEED_TARGET: "test",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
        }),
      /prohibido|TEST|ep-delicate-river/,
    );
  });

  it("acepta TEST con opt-in explícito", () => {
    const id = assertPrismaSeedAllowed({
      PRISMA_SEED_TARGET: "test",
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST, true),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
    });
    assert.equal(id, NEON_ENDPOINTS.TEST);
  });
});

describe("assertDevRecoveryBootstrapTarget", () => {
  it("exige BOOTSTRAP_TARGET explícito", () => {
    assert.throws(
      () =>
        assertDevRecoveryBootstrapTarget({
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
        }),
      /BOOTSTRAP_TARGET/,
    );
  });

  it("rechaza TEST aunque el target esté definido", () => {
    assert.throws(
      () =>
        assertDevRecoveryBootstrapTarget({
          BOOTSTRAP_TARGET: "dev-from-recovery",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /ep-delicate-river|recibido/,
    );
  });

  it("acepta desarrollo recuperado con opt-in", () => {
    const id = assertDevRecoveryBootstrapTarget({
      BOOTSTRAP_TARGET: "dev-from-recovery",
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY, { pooler: true }),
      DIRECT_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
    });
    assert.equal(id, NEON_ENDPOINTS.DEV_RECOVERY);
  });

  it("regresión: production target no habilita recovery-dev bootstrap", () => {
    assert.throws(
      () =>
        assertDevRecoveryBootstrapTarget({
          BOOTSTRAP_TARGET: "production",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
          CONFIRM_PRODUCTION_BOOTSTRAP: CONFIRM_PRODUCTION_BOOTSTRAP_VALUE,
        }),
      /BOOTSTRAP_TARGET/,
    );
  });
});

describe("assertProductionBootstrapTarget", () => {
  const prodEnv = () => ({
    BOOTSTRAP_TARGET: "production",
    CONFIRM_PRODUCTION_BOOTSTRAP: CONFIRM_PRODUCTION_BOOTSTRAP_VALUE,
    DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION, { pooler: true }),
    DIRECT_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
  });

  it("exige BOOTSTRAP_TARGET=production", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          BOOTSTRAP_TARGET: "dev-from-recovery",
        }),
      /BOOTSTRAP_TARGET/,
    );
  });

  it("exige confirmación explícita", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          CONFIRM_PRODUCTION_BOOTSTRAP: "wrong",
        }),
      /CONFIRM_PRODUCTION_BOOTSTRAP/,
    );
  });

  it("exige DIRECT_URL", () => {
    const env = prodEnv();
    delete (env as { DIRECT_URL?: string }).DIRECT_URL;
    assert.throws(() => assertProductionBootstrapTarget(env), /DIRECT_URL/);
  });

  it("rechaza TEST", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /TEST/,
    );
  });

  it("rechaza recovery", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.RECOVERY),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.RECOVERY),
        }),
      /recovery/,
    );
  });

  it("rechaza dev-from-recovery", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.DEV_RECOVERY),
        }),
      /dev-from-recovery/,
    );
  });

  it("rechaza DATABASE y DIRECT con endpoints distintos", () => {
    assert.throws(
      () =>
        assertProductionBootstrapTarget({
          ...prodEnv(),
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      /DIRECT_URL|TEST|producción/,
    );
  });

  it("acepta PRODUCTION con dual opt-in y no filtra secretos en el error path", () => {
    const id = assertProductionBootstrapTarget(prodEnv());
    assert.equal(id, NEON_ENDPOINTS.PRODUCTION);
    try {
      assertProductionBootstrapTarget({
        ...prodEnv(),
        BOOTSTRAP_TARGET: "",
      });
    } catch (e) {
      assertNoSecrets(e instanceof Error ? e.message : String(e));
    }
  });
});
