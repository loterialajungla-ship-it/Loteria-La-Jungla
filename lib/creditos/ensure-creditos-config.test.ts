import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFIRM_CREDITS_ENSURE_PRODUCTION_VALUE,
  CreditsEnsureError,
  assertCreditsEnsureTarget,
  parseCreditsEnsureDryRun,
  planEnsureCreditosConfig,
  resolveCreditsEnsureDatabaseUrl,
  runEnsureCreditosConfig,
  verifyInsertedCreditosConfig,
  type EnsureCreditosConfigDb,
} from "@/lib/creditos/ensure-creditos-config";
import { NEON_ENDPOINTS } from "@/lib/db/neon-endpoint-guard";

const SECRET = "unit-test-secret-never-log";

function neonUrl(endpoint: string): string {
  return `postgresql://neondb_owner:${SECRET}@${endpoint}.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require`;
}

function assertNoSecrets(text: string): void {
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, new RegExp(SECRET, "i"));
}

function testEnv(
  partial: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return partial;
}

describe("assertCreditsEnsureTarget", () => {
  it("rechaza destino ausente", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "TARGET_REQUIRED");
        assertNoSecrets(e.message);
        return true;
      },
    );
  });

  it("rechaza URL ausente aunque haya DATABASE_URL genérica", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "test",
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
          DIRECT_URL: neonUrl(NEON_ENDPOINTS.TEST),
          TEST_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "URL_REQUIRED");
        assert.match(e.message, /No uses DATABASE_URL/i);
        assertNoSecrets(e.message);
        return true;
      },
    );
  });

  it("resolveCreditsEnsureDatabaseUrl rechaza genéricas como único aporte", () => {
    assert.throws(
      () =>
        resolveCreditsEnsureDatabaseUrl({
          DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      (e: unknown) =>
        e instanceof CreditsEnsureError && e.code === "URL_REQUIRED",
    );
  });

  it("production + URL TEST debe rechazarse", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "production",
          CREDITS_ENSURE_PRODUCTION: "1",
          CONFIRM_CREDITS_ENSURE_PRODUCTION:
            CONFIRM_CREDITS_ENSURE_PRODUCTION_VALUE,
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "ENDPOINT_MISMATCH");
        assertNoSecrets(e.message);
        return true;
      },
    );
  });

  it("test + URL producción debe rechazarse", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "test",
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.match(e.code, /FORBIDDEN|MISMATCH/);
        assertNoSecrets(e.message);
        return true;
      },
    );
  });

  it("endpoint recovery no autorizado debe rechazarse", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "test",
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.RECOVERY),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "ENDPOINT_FORBIDDEN");
        return true;
      },
    );
  });

  it("rechaza producción sin opt-in explícito", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "production",
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "PROD_OPT_IN_REQUIRED");
        return true;
      },
    );
  });

  it("rechaza producción sin frase de confirmación", () => {
    assert.throws(
      () =>
        assertCreditsEnsureTarget({
          CREDITS_ENSURE_TARGET: "production",
          CREDITS_ENSURE_PRODUCTION: "1",
          CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
        }),
      (e: unknown) => {
        assert.ok(e instanceof CreditsEnsureError);
        assert.equal(e.code, "PROD_CONFIRM_REQUIRED");
        return true;
      },
    );
  });

  it("acepta test con URL dedicada", () => {
    const r = assertCreditsEnsureTarget({
      CREDITS_ENSURE_TARGET: "test",
      CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
      DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.target, "test");
    assert.equal(r.endpointId, NEON_ENDPOINTS.TEST);
  });

  it("acepta production con doble opt-in", () => {
    const r = assertCreditsEnsureTarget({
      CREDITS_ENSURE_TARGET: "production",
      CREDITS_ENSURE_PRODUCTION: "1",
      CONFIRM_CREDITS_ENSURE_PRODUCTION: CONFIRM_CREDITS_ENSURE_PRODUCTION_VALUE,
      CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.PRODUCTION),
    });
    assert.equal(r.target, "production");
    assert.equal(r.endpointId, NEON_ENDPOINTS.PRODUCTION);
  });
});

describe("planEnsureCreditosConfig + verify", () => {
  it("inserta si falta la fila", () => {
    const plan = planEnsureCreditosConfig(null);
    assert.equal(plan.action, "insert");
    if (plan.action === "insert") {
      assert.equal(plan.values.controlActivo, false);
      assert.equal(plan.values.inicioEn, null);
      assert.equal(plan.values.umbralSaldoBajo, null);
    }
  });

  it("si existe, no modifica valores (skip)", () => {
    const plan = planEnsureCreditosConfig({ id: 1 });
    assert.equal(plan.action, "skip");
  });

  it("es idempotente: skip + skip", () => {
    assert.equal(planEnsureCreditosConfig({ id: 1 }).action, "skip");
    assert.equal(planEnsureCreditosConfig({ id: 1 }).action, "skip");
  });

  it("verifyInserted exige controlActivo=false e inicioEn=null", () => {
    const ok = verifyInsertedCreditosConfig({
      id: 1,
      controlActivo: false,
      inicioEn: null,
      umbralSaldoBajo: null,
      updatedByAdminId: null,
    });
    assert.equal(ok.ok, true);

    const bad = verifyInsertedCreditosConfig({
      id: 1,
      controlActivo: true,
      inicioEn: null,
      umbralSaldoBajo: null,
      updatedByAdminId: null,
    });
    assert.equal(bad.ok, false);
  });

  it("dry-run flag", () => {
    assert.equal(parseCreditsEnsureDryRun(["--dry-run"]), true);
    assert.equal(parseCreditsEnsureDryRun([]), false);
  });
});

describe("runEnsureCreditosConfig dry-run (mock DB)", () => {
  function mockDb(opts: {
    existing: boolean;
    onInsert?: () => void;
  }): EnsureCreditosConfigDb & { insertCalls: number; disconnected: boolean } {
    let insertCalls = 0;
    let disconnected = false;
    const api: EnsureCreditosConfigDb & {
      insertCalls: number;
      disconnected: boolean;
    } = {
      get insertCalls() {
        return insertCalls;
      },
      get disconnected() {
        return disconnected;
      },
      async findConfigSingleton() {
        if (!opts.existing) return null;
        return {
          id: 1,
          controlActivo: false,
          inicioEn: null,
          umbralSaldoBajo: null,
          updatedByAdminId: null,
        };
      },
      async insertBootstrapIfAbsent() {
        insertCalls += 1;
        opts.onInsert?.();
        return 1;
      },
      async disconnect() {
        disconnected = true;
      },
    };
    return api;
  }

  it("dry-run valida destino, consulta existencia y nunca escribe", async () => {
    const db = mockDb({ existing: false });
    let createDbCalls = 0;
    const result = await runEnsureCreditosConfig({
      env: testEnv({
        CREDITS_ENSURE_TARGET: "test",
        CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
      }),
      argv: ["--dry-run"],
      createDb: () => {
        createDbCalls += 1;
        return db;
      },
    });
    assert.equal(createDbCalls, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.wrote, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.outcome, "dry_run_would_insert");
    assert.equal(db.insertCalls, 0);
    assert.equal(db.disconnected, true);
    assert.match(result.messages.join("\n"), /no se escribió nada/i);
  });

  it("dry-run con fila existente no escribe", async () => {
    const db = mockDb({ existing: true });
    const result = await runEnsureCreditosConfig({
      env: testEnv({
        CREDITS_ENSURE_TARGET: "test",
        CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
      }),
      argv: ["--dry-run"],
      createDb: () => db,
    });
    assert.equal(result.outcome, "skipped_existing");
    assert.equal(result.wrote, false);
    assert.equal(db.insertCalls, 0);
  });

  it("guard fallido no crea DB ni escribe", async () => {
    let createDbCalls = 0;
    const result = await runEnsureCreditosConfig({
      env: testEnv({
        CREDITS_ENSURE_TARGET: "production",
        CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
      }),
      argv: ["--dry-run"],
      createDb: () => {
        createDbCalls += 1;
        return mockDb({ existing: false });
      },
    });
    assert.equal(createDbCalls, 0);
    assert.equal(result.exitCode, 2);
    assert.equal(result.wrote, false);
    assert.equal(result.outcome, "guard_error");
  });

  it("modo real con mock inserta una vez", async () => {
    let row: {
      id: number;
      controlActivo: boolean;
      inicioEn: Date | null;
      umbralSaldoBajo: null;
      updatedByAdminId: null;
    } | null = null;
    const db: EnsureCreditosConfigDb = {
      async findConfigSingleton() {
        return row;
      },
      async insertBootstrapIfAbsent() {
        row = {
          id: 1,
          controlActivo: false,
          inicioEn: null,
          umbralSaldoBajo: null,
          updatedByAdminId: null,
        };
        return 1;
      },
    };
    const result = await runEnsureCreditosConfig({
      env: testEnv({
        CREDITS_ENSURE_TARGET: "test",
        CREDITS_ENSURE_DATABASE_URL: neonUrl(NEON_ENDPOINTS.TEST),
      }),
      argv: [],
      createDb: () => db,
    });
    assert.equal(result.outcome, "inserted");
    assert.equal(result.wrote, true);
    assert.ok(row);
  });
});
