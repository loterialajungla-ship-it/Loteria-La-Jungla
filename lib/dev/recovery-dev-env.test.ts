import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";
import {
  DEV_RECOVERY_COLLISION_MESSAGE,
  DEV_RECOVERY_ENDPOINT_MESSAGE,
  DEV_RECOVERY_ENDPOINT_MISMATCH_MESSAGE,
  DEV_RECOVERY_EXPECTED_ENDPOINT,
  DEV_RECOVERY_INVALID_URL_MESSAGE,
  DEV_RECOVERY_MISSING_DIRECT_MESSAGE,
  DEV_RECOVERY_MISSING_POOLED_MESSAGE,
  DEV_RECOVERY_POOLER_ON_DIRECT_MESSAGE,
  DEV_RECOVERY_PROTOCOL_MESSAGE,
  formatRecoveryDevBanner,
  parseRecoveryPostgresUrl,
  prepareRecoveryDevEnv,
} from "@/lib/dev/recovery-dev-env";

const EP = DEV_RECOVERY_EXPECTED_ENDPOINT;
const SECRET = "super-secret-password-xyz";

function pooledUrl(endpoint = EP): string {
  return `postgresql://neondb_owner:${SECRET}@${endpoint}-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;
}

function directUrl(endpoint = EP): string {
  return `postgresql://neondb_owner:${SECRET}@${endpoint}.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
  assert.doesNotMatch(text, /neondb_owner/i);
  assert.doesNotMatch(text, /sslmode/i);
  assert.doesNotMatch(text, /:\/\/[^/\s]+@/i);
}

describe("parseRecoveryPostgresUrl", () => {
  it("acepta pooled y directa del endpoint autorizado", () => {
    const p = parseRecoveryPostgresUrl(pooledUrl());
    assert.equal(p.ok, true);
    if (!p.ok) return;
    assert.equal(p.endpointId, EP);
    assert.equal(p.hasPoolerSuffix, true);

    const d = parseRecoveryPostgresUrl(directUrl());
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.endpointId, EP);
    assert.equal(d.hasPoolerSuffix, false);
  });

  it("rechaza ID correcto con dominio falso", () => {
    const r = parseRecoveryPostgresUrl(
      `postgresql://u:${SECRET}@${EP}.evil.example/neondb`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_INVALID_URL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("rechaza subdominio engañoso de Neon", () => {
    const r = parseRecoveryPostgresUrl(
      `postgresql://u:${SECRET}@${EP}.evil.neon.tech/neondb`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_INVALID_URL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("rechaza protocolo no permitido sin filtrar secretos", () => {
    const r = parseRecoveryPostgresUrl(
      `mysql://u:${SECRET}@${EP}.c-6.us-east-2.aws.neon.tech/db`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_PROTOCOL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("rechaza URL malformada", () => {
    const r = parseRecoveryPostgresUrl("postgresql://");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_INVALID_URL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("parsea otros endpoints ep-* válidos Neon (allowlist en prepare)", () => {
    const r = parseRecoveryPostgresUrl(directUrl("ep-spring-silence-b40xhu8w"));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.endpointId, "ep-spring-silence-b40xhu8w");
  });
});

describe("prepareRecoveryDevEnv (dev:recovery)", () => {
  it("variables ausentes → error", () => {
    const missingPooled = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
    });
    assert.equal(missingPooled.ok, false);
    if (!missingPooled.ok) {
      assert.equal(missingPooled.reason, DEV_RECOVERY_MISSING_POOLED_MESSAGE);
      assertNoSecrets(missingPooled.reason);
    }

    const missingDirect = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(),
    });
    assert.equal(missingDirect.ok, false);
    if (!missingDirect.ok) {
      assert.equal(missingDirect.reason, DEV_RECOVERY_MISSING_DIRECT_MESSAGE);
      assertNoSecrets(missingDirect.reason);
    }
  });

  it("URL malformada → error sin secretos", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: "postgresql://",
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_INVALID_URL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("protocolo no permitido → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: `http://u:${SECRET}@host/db`,
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_PROTOCOL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("dominio falso con ID de recovery → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: `postgresql://u:${SECRET}@${EP}-pooler.evil.example/neondb`,
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_INVALID_URL_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("endpoint de producción → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(NEON_ENDPOINTS.PRODUCTION),
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_ENDPOINT_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("endpoint de recuperación original → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(NEON_ENDPOINTS.RECOVERY),
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(NEON_ENDPOINTS.RECOVERY),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_ENDPOINT_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("endpoint TEST → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(NEON_ENDPOINTS.TEST),
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(NEON_ENDPOINTS.TEST),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_ENDPOINT_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("pooled/direct con endpoints distintos → error de mismatch", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(EP),
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(NEON_ENDPOINTS.TEST),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_ENDPOINT_MISMATCH_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("directa con -pooler → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(),
      DEV_FROM_RECOVERY_DIRECT_URL: pooledUrl(),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_POOLER_ON_DIRECT_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("colisión por misma URL string con DATABASE_URL del padre → error", () => {
    const pooled = pooledUrl();
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooled,
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
      DATABASE_URL: pooled,
      DIRECT_URL: directUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_COLLISION_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("colisión por mismo endpoint ID con URL distinta del padre → error", () => {
    const r = prepareRecoveryDevEnv({
      DEV_FROM_RECOVERY_DATABASE_URL: pooledUrl(),
      DEV_FROM_RECOVERY_DIRECT_URL: directUrl(),
      // Misma rama recovery, distinta contraseña/usuario → mismo endpoint ID
      DATABASE_URL: `postgresql://other:${SECRET}@${EP}-pooler.c-6.us-east-2.aws.neon.tech/neondb`,
      DIRECT_URL: directUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, DEV_RECOVERY_COLLISION_MESSAGE);
      assertNoSecrets(r.reason);
    }
  });

  it("éxito: inyecta URLs validadas en el hijo sin mutar el padre", () => {
    const pooled = pooledUrl();
    const direct = directUrl();
    const parent = {
      DEV_FROM_RECOVERY_DATABASE_URL: pooled,
      DEV_FROM_RECOVERY_DIRECT_URL: direct,
      DATABASE_URL: pooledUrl(NEON_ENDPOINTS.PRODUCTION),
      DIRECT_URL: directUrl(NEON_ENDPOINTS.PRODUCTION),
      PATH: "/usr/bin",
      AUTH_SESSION_HOURS: "12",
    };
    const snapDb = parent.DATABASE_URL;
    const snapDirect = parent.DIRECT_URL;

    const r = prepareRecoveryDevEnv(parent);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.endpointId, EP);
    assert.equal(r.childEnv.DATABASE_URL, pooled);
    assert.equal(r.childEnv.DIRECT_URL, direct);
    assert.equal(r.childEnv.AUTH_SESSION_HOURS, "12");
    assert.equal(parent.DATABASE_URL, snapDb);
    assert.equal(parent.DIRECT_URL, snapDirect);
  });

  it("banner y errores no exponen secretos", () => {
    const banner = formatRecoveryDevBanner(EP);
    assert.match(banner, /RECOVERY DEVELOPMENT DATABASE/);
    assert.match(banner, new RegExp(EP));
    assert.match(banner, /dev-from-recovery/);
    assertNoSecrets(banner);
  });
});
