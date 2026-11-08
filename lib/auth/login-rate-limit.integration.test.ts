/**
 * Concurrencia real del límite de login contra PostgreSQL TEST.
 * Solo vía `npm run test:integration` (`RUN_INTEGRATION=1`).
 * No toca tickets, resultados ni créditos.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loginWithCredentials } from "@/lib/auth/login";
import {
  LOGIN_RATE_IP_METRIC_CAP,
  LOGIN_RATE_MAX_PAIR,
  LOGIN_RATE_PURGE_BATCH,
  LOGIN_RATE_WINDOW_MS,
  createPrismaLoginRateLimiter,
  loginRateKeys,
} from "@/lib/auth/login-rate-limit";
import { createIntegrationPrismaClient } from "@/lib/tickets/integration/harness";
import { assertIntegrationPointsAtTestDatabase } from "@/lib/tickets/integration/assert-integration-test-db";

const ENABLED = process.env.RUN_INTEGRATION === "1";
const SECRET = "integration-login-rate-limit-secret-32";
const PASSWORD = "clave-integra-99";

describe(
  "integración PostgreSQL — límite de login",
  { skip: !ENABLED, concurrency: 1 },
  () => {
  let db: ReturnType<typeof createIntegrationPrismaClient>;
  let userId = "";
  const usuario = `b22_${Date.now().toString(36)}`.slice(0, 32);
  const trackedKeys = new Set<string>();

  function track(ip: string, name: string) {
    const keys = loginRateKeys(SECRET, ip, name);
    trackedKeys.add(keys.ipKey);
    trackedKeys.add(keys.pairKey);
    return keys;
  }

  before(async () => {
    assertIntegrationPointsAtTestDatabase();
    assert.equal(
      assertIntegrationPointsAtTestDatabase(),
      "ep-muddy-fire-b44816w0",
    );
    db = createIntegrationPrismaClient();
    const row = await db.usuario.create({
      data: {
        nombre: "B22 rate",
        usuario,
        passwordHash: await hashPassword(PASSWORD),
        rol: "ADMIN",
        activo: true,
      },
    });
    userId = row.id;
  });

  after(async () => {
    if (!db) return;
    try {
      const keys = [...trackedKeys];
      if (keys.length > 0) {
        await db.loginRateBucket.deleteMany({ where: { key: { in: keys } } });
      }
      if (userId) {
        await db.auditoria.deleteMany({ where: { usuarioId: userId } });
        await db.usuario.delete({ where: { id: userId } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  it("una ráfaga concurrente no supera cinco verificaciones", async () => {
    const ip = "203.0.113.40";
    track(ip, usuario);
    const store = createPrismaLoginRateLimiter(db);
    let verifies = 0;
    const verify = async (password: string, hash: string) => {
      verifies += 1;
      return verifyPassword(password, hash);
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        loginWithCredentials(db, {
          usuario,
          password: "clave-incorrecta-1",
          clientIp: ip,
          rateLimitSecret: SECRET,
          rateLimit: store,
          verifyPassword: verify,
        }),
      ),
    );
    assert.equal(results.every((item) => item === null), true);
    assert.equal(verifies, LOGIN_RATE_MAX_PAIR);
    let extra = 0;
    const sixth = await loginWithCredentials(db, {
      usuario,
      password: PASSWORD,
      clientIp: ip,
      rateLimitSecret: SECRET,
      rateLimit: store,
      verifyPassword: async () => {
        extra += 1;
        return true;
      },
    });
    assert.equal(sixth, null);
    assert.equal(extra, 0);
  });

  it("el login correcto reinicia la pareja y la métrica de IP no lo bloquea", async () => {
    const ip = "203.0.113.41";
    const store = createPrismaLoginRateLimiter(db);
    const now = new Date();
    const metric = track(ip, usuario);
    await db.loginRateBucket.create({
      data: {
        key: metric.ipKey,
        failures: LOGIN_RATE_IP_METRIC_CAP,
        windowStart: now,
        updatedAt: now,
      },
    });
    const saturated = await store.reserveAttempt(metric.ipKey, metric.pairKey, now);
    assert.equal(saturated.ipFailures, LOGIN_RATE_IP_METRIC_CAP);
    assert.equal(saturated.outcome, "allowed");

    const ok = await loginWithCredentials(db, {
      usuario,
      password: PASSWORD,
      clientIp: ip,
      rateLimitSecret: SECRET,
      rateLimit: store,
    });
    assert.ok(ok);
    await db.usuarioSesion.deleteMany({ where: { usuarioId: userId } });

    let failures = 0;
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR; i += 1) {
      const failed = await loginWithCredentials(db, {
        usuario,
        password: "otra-clave-distinta",
        clientIp: ip,
        rateLimitSecret: SECRET,
        rateLimit: store,
        verifyPassword: async () => {
          failures += 1;
          return false;
        },
      });
      assert.equal(failed, null);
    }
    assert.equal(failures, LOGIN_RATE_MAX_PAIR);
  });

  it("la limpieza no borra una ventana activa", async () => {
    const store = createPrismaLoginRateLimiter(db);
    const old = new Date(Date.now() - LOGIN_RATE_WINDOW_MS - 60_000);
    const current = new Date();
    const expired = track("203.0.113.42", "caducado");
    const active = track("203.0.113.43", "activo");
    await db.loginRateBucket.createMany({
      data: [
        {
          key: expired.pairKey,
          failures: 4,
          windowStart: old,
          updatedAt: old,
        },
        {
          key: active.pairKey,
          failures: 2,
          windowStart: current,
          updatedAt: current,
        },
      ],
    });
    const removed = await store.purgeExpired(current, 10);
    assert.ok(removed >= 1);
    const gone = await db.loginRateBucket.findUnique({
      where: { key: expired.pairKey },
    });
    const kept = await db.loginRateBucket.findUnique({
      where: { key: active.pairKey },
    });
    assert.equal(gone, null);
    assert.equal(kept?.failures, 2);
  });

  it("un error de PostgreSQL no abre sesión", async () => {
    let verifies = 0;
    const broken = createPrismaLoginRateLimiter({
      $transaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> => {
        void fn;
        await db.$queryRaw`SELECT 1 / 0`;
        throw new Error("postgres");
      },
    });
    const result = await loginWithCredentials(db, {
      usuario,
      password: PASSWORD,
      clientIp: "203.0.113.44",
      rateLimitSecret: SECRET,
      rateLimit: broken,
      verifyPassword: async () => {
        verifies += 1;
        return true;
      },
    });
    assert.equal(result, null);
    assert.equal(verifies, 0);
    assert.equal(await db.usuarioSesion.count({ where: { usuarioId: userId } }), 0);
  });

  it("no queda una clave global missing-edge-ip", async () => {
    const found = await db.loginRateBucket.count({
      where: { key: { contains: "missing-edge-ip" } },
    });
    assert.equal(found, 0);
  });

  it("cien peticiones concurrentes reservan cinco y no abren sesión", async () => {
    const ip = "203.0.113.50";
    const keys = track(ip, usuario);
    const store = createPrismaLoginRateLimiter(db, {
      reserveMaxWaitMs: 60_000,
      reserveTimeoutMs: 60_000,
    });
    let verifies = 0;
    const wrongPassword = "clave-incorrecta-100";
    const sessionsBefore = await db.usuarioSesion.count({
      where: { usuarioId: userId },
    });
    const auditsBefore = await db.auditoria.count({
      where: { usuarioId: userId, accion: "LOGIN_FALLIDO" },
    });
    const settled = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        loginWithCredentials(db, {
          usuario,
          password: wrongPassword,
          clientIp: ip,
          rateLimitSecret: SECRET,
          rateLimit: store,
          verifyPassword: async (password, hash) => {
            verifies += 1;
            return verifyPassword(password, hash);
          },
        }),
      ),
    );
    const rejected = settled.filter((item) => item.status === "rejected");
    const values = settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);
    assert.equal(rejected.length, 0);
    assert.equal(values.length, 100);
    assert.equal(values.every((item) => item === null), true);
    assert.equal(verifies, LOGIN_RATE_MAX_PAIR);
    const pair = await db.loginRateBucket.findUnique({
      where: { key: keys.pairKey },
    });
    assert.equal(pair?.failures, LOGIN_RATE_MAX_PAIR);
    assert.equal(pair?.key.includes(ip), false);
    assert.equal(
      await db.usuarioSesion.count({ where: { usuarioId: userId } }),
      sessionsBefore,
    );
    const auditsAfter = await db.auditoria.count({
      where: { usuarioId: userId, accion: "LOGIN_FALLIDO" },
    });
    assert.equal(auditsAfter - auditsBefore, LOGIN_RATE_MAX_PAIR);
    const audits = await db.auditoria.findMany({
      where: { usuarioId: userId, accion: "LOGIN_FALLIDO" },
      orderBy: { createdAt: "desc" },
      take: LOGIN_RATE_MAX_PAIR,
    });
    const raw = JSON.stringify(audits);
    assert.equal(raw.includes(wrongPassword), false);
    assert.equal(raw.includes(SECRET), false);
    assert.equal(raw.includes(ip), false);
  });

  it("la limpieza borra como máximo 32 filas y no toca la ventana activa", async () => {
    const store = createPrismaLoginRateLimiter(db);
    const now = new Date();
    const oldBase = now.getTime() - LOGIN_RATE_WINDOW_MS - 120_000;
    const expired = Array.from({ length: 40 }, (_, index) => {
      const key = `b22purge:${index.toString().padStart(2, "0")}`;
      trackedKeys.add(key);
      return {
        key,
        failures: 1,
        windowStart: new Date(oldBase + index * 1000),
        updatedAt: now,
      };
    });
    const activeKey = "b22purge:active";
    trackedKeys.add(activeKey);
    await db.loginRateBucket.createMany({
      data: [
        ...expired,
        {
          key: activeKey,
          failures: 3,
          windowStart: now,
          updatedAt: now,
        },
      ],
    });
    const removed = await store.purgeExpired(now);
    assert.equal(removed, LOGIN_RATE_PURGE_BATCH);
    const left = await db.loginRateBucket.count({
      where: { key: { startsWith: "b22purge:" } },
    });
    assert.equal(left, 40 - LOGIN_RATE_PURGE_BATCH + 1);
    const active = await db.loginRateBucket.findUnique({
      where: { key: activeKey },
    });
    assert.equal(active?.failures, 3);
  });

  it("dos limpiezas no se pisan y un borrado lento no retiene la reserva", async () => {
    const store = createPrismaLoginRateLimiter(db);
    const now = new Date();
    const hold = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('login-rate-bucket-purge'))`;
        await tx.$queryRaw`SELECT pg_sleep(2)::text AS slept`;
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const skipped = await store.purgeExpired(now);
    assert.equal(skipped, 0);
    const ip = "203.0.113.60";
    const keys = track(ip, "reserva-durante-limpieza");
    const started = Date.now();
    const reserved = await store.reserveAttempt(keys.ipKey, keys.pairKey, now);
    const elapsed = Date.now() - started;
    assert.equal(reserved.outcome, "allowed");
    assert.ok(elapsed < 1200, `la reserva esperó ${elapsed}ms`);
    await hold;

    const ipHold = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${keys.ipKey}))`;
        await tx.$queryRaw`SELECT pg_sleep(2)::text AS slept`;
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const purgeStarted = Date.now();
    await store.purgeExpired(now);
    const purgeElapsed = Date.now() - purgeStarted;
    assert.ok(purgeElapsed < 1200, `la limpieza esperó ${purgeElapsed}ms`);
    await ipHold;
  });

  it("un fallo de limpieza no abre un sexto intento", async () => {
    const ip = "203.0.113.61";
    track(ip, usuario);
    const flaky = createPrismaLoginRateLimiter({
      $transaction: async (fn, options) => {
        if (options?.timeout === 2_000) {
          throw new Error("purge-failed");
        }
        return db.$transaction(fn, options);
      },
    });
    let verifies = 0;
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR + 2; i += 1) {
      const result = await loginWithCredentials(db, {
        usuario,
        password: "otra-clave-limpieza",
        clientIp: ip,
        rateLimitSecret: SECRET,
        rateLimit: flaky,
        verifyPassword: async () => {
          verifies += 1;
          return false;
        },
      });
      assert.equal(result, null);
    }
    assert.equal(verifies, LOGIN_RATE_MAX_PAIR);
    assert.equal(await db.usuarioSesion.count({ where: { usuarioId: userId } }), 0);
  });

  it("la migración y el índice de retención están en TEST", async () => {
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = '20261107225000_login_rate_limit'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    `;
    assert.equal(applied.length, 1);
    const index = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'LoginRateBucket'
        AND indexname = 'LoginRateBucket_windowStart_idx'
    `;
    assert.equal(index.length, 1);
    const columns = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'LoginRateBucket'
      ORDER BY column_name
    `;
    assert.deepEqual(
      columns.map((column) => column.column_name),
      ["failures", "key", "updatedAt", "windowStart"],
    );
    assert.equal(
      columns.find((column) => column.column_name === "failures")?.data_type,
      "integer",
    );
    assert.equal(
      columns.find((column) => column.column_name === "key")?.data_type,
      "text",
    );
  });
});
