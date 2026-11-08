import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Límite estricto: 5 fallos por pareja IP+usuario en una ventana fija de 15 minutos.
 * El contador por IP es solo una métrica saturada: no niega un login correcto.
 * Un ataque distribuido obtiene como máximo 5 intentos por cada IP de origen y usuario.
 * No hay tope global por usuario: ese tope permitiría bloquear la cuenta desde muchas IP.
 * Rotar LOGIN_RATE_LIMIT_SECRET cambia las claves HMAC y deja de usar los contadores viejos.
 */
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_MAX_PAIR = 5;
/** Tope de almacenamiento del agregado por IP. No decide el acceso. */
export const LOGIN_RATE_IP_METRIC_CAP = 20;
export const LOGIN_RATE_PURGE_BATCH = 32;
export const LOGIN_RATE_SECRET_ENV = "LOGIN_RATE_LIMIT_SECRET";
export const LOGIN_RATE_SECRET_MIN_LENGTH = 32;
export const LOGIN_RATE_DEV_IP_ENV = "LOGIN_RATE_LIMIT_DEV_IP";

/**
 * Hash bcrypt fijo, coste 12, de una cadena que no es contraseña de ningún usuario.
 * Se reutiliza para usuarios inexistentes o inactivos. No regenerar por petición.
 */
export const LOGIN_DUMMY_BCRYPT_HASH =
  "$2b$12$iIjLt1TVl6zViSO2vPPN2OQKAgnCT53E63rfuZMF9p2blSlcpkC.G";

export type ReserveAttemptResult = {
  outcome: "allowed" | "limited";
  pairFailures: number;
  ipFailures: number;
};

export type LoginRateLimitStore = {
  /**
   * Comprueba el tope de pareja y, si cabe, reserva el intento en la misma
   * sección crítica. Una petición limitada no incrementa ni debe llegar a bcrypt.
   */
  reserveAttempt(
    ipKey: string,
    pairKey: string,
    now: Date,
  ): Promise<ReserveAttemptResult>;
  /**
   * Tras contraseña correcta de un intento ya reservado: pone a cero solo
   * la pareja. No abre un intento extra si la reserva fue rechazada.
   */
  commitSuccess(ipKey: string, pairKey: string, now: Date): Promise<void>;
  /** Borra como máximo `limit` filas con ventana ya vencida. */
  purgeExpired(now: Date, limit?: number): Promise<number>;
};

type Bucket = { failures: number; windowStart: number };

function effectiveFailures(bucket: Bucket | undefined, now: Date): number {
  if (!bucket) return 0;
  if (now.getTime() - bucket.windowStart >= LOGIN_RATE_WINDOW_MS) return 0;
  return bucket.failures;
}

export function assertLoginRateSecret(secret: string | undefined | null): string {
  const value = secret?.trim() ?? "";
  if (value.length < LOGIN_RATE_SECRET_MIN_LENGTH) {
    throw new Error(
      `${LOGIN_RATE_SECRET_ENV} ausente o demasiado corto (mínimo ${LOGIN_RATE_SECRET_MIN_LENGTH}). El login no se abre sin este secreto.`,
    );
  }
  return value;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Rechaza reutilizar CRON_SECRET cuando ambos valores están configurados. */
export function assertLoginRateSecretDistinct(
  secret: string | undefined | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const value = assertLoginRateSecret(secret);
  const cron = env.CRON_SECRET?.trim() ?? "";
  if (cron && sameSecret(value, cron)) {
    throw new Error(
      `${LOGIN_RATE_SECRET_ENV} no puede coincidir con CRON_SECRET.`,
    );
  }
  return value;
}

export function readLoginRateSecret(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  return assertLoginRateSecretDistinct(env[LOGIN_RATE_SECRET_ENV], env);
}

/** HMAC-SHA256 hex. No almacena la IP ni el usuario en claro. */
export function loginRateFingerprint(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material, "utf8").digest("hex");
}

export function loginRateKeys(
  secret: string,
  clientIp: string,
  usuarioNormalizado: string,
): { ipKey: string; pairKey: string } {
  const ip = clientIp.trim().toLowerCase();
  const user = usuarioNormalizado.trim().toLowerCase();
  const ipKey = `ip:${loginRateFingerprint(secret, `ip\0${ip}`)}`;
  const pairKey = `pair:${loginRateFingerprint(secret, `pair\0${ip}\0${user}`)}`;
  return { ipKey, pairKey };
}

export type LoginClientIpResolution =
  | { status: "trusted"; ip: string }
  | { status: "dev"; ip: string }
  | { status: "rejected" };

function firstHop(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function normalizeIpLabel(value: string): string {
  return value.trim().toLowerCase();
}

function isProductionEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * IP de borde en Vercel. No usa X-Forwarded-For: el cliente puede falsificarla.
 * Sin IP confiable no hay clave compartida. El puesto local solo existe fuera
 * de producción y de Vercel, mediante LOGIN_RATE_LIMIT_DEV_IP.
 */
export function resolveLoginClientIp(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): LoginClientIpResolution {
  const onVercel = env.VERCEL === "1";
  if (onVercel) {
    const fromVercel = firstHop(request.headers.get("x-vercel-forwarded-for"));
    if (fromVercel) return { status: "trusted", ip: normalizeIpLabel(fromVercel) };
    const real = request.headers.get("x-real-ip")?.trim() ?? "";
    if (real) return { status: "trusted", ip: normalizeIpLabel(real) };
    return { status: "rejected" };
  }

  if (isProductionEnv(env)) return { status: "rejected" };

  const dev = env[LOGIN_RATE_DEV_IP_ENV]?.trim() ?? "";
  if (!dev || dev.length > 64) return { status: "rejected" };
  return { status: "dev", ip: normalizeIpLabel(dev) };
}

type MemoryState = Map<string, Bucket>;

export function createMemoryLoginRateLimiter(): LoginRateLimitStore {
  const rows: MemoryState = new Map();
  let chain: Promise<void> = Promise.resolve();

  function locked<T>(fn: () => T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function read(key: string, now: Date): number {
    return effectiveFailures(rows.get(key), now);
  }

  function windowStartFor(key: string, now: Date): number {
    const current = rows.get(key);
    if (!current || now.getTime() - current.windowStart >= LOGIN_RATE_WINDOW_MS) {
      return now.getTime();
    }
    return current.windowStart;
  }

  function purge(now: Date, limit: number): number {
    const cutoff = now.getTime() - LOGIN_RATE_WINDOW_MS;
    const expired = [...rows.entries()]
      .filter(([, bucket]) => bucket.windowStart < cutoff)
      .sort((a, b) => a[1].windowStart - b[1].windowStart)
      .slice(0, limit);
    for (const [key] of expired) rows.delete(key);
    return expired.length;
  }

  return {
    reserveAttempt(ipKey, pairKey, now) {
      return locked(() => {
        purge(now, LOGIN_RATE_PURGE_BATCH);
        const pairFailures = read(pairKey, now);
        const ipFailures = read(ipKey, now);
        if (pairFailures >= LOGIN_RATE_MAX_PAIR) {
          return {
            outcome: "limited" as const,
            pairFailures,
            ipFailures,
          };
        }
        const nextPair = pairFailures + 1;
        const nextIp =
          ipFailures >= LOGIN_RATE_IP_METRIC_CAP
            ? LOGIN_RATE_IP_METRIC_CAP
            : ipFailures + 1;
        rows.set(pairKey, {
          failures: nextPair,
          windowStart: windowStartFor(pairKey, now),
        });
        rows.set(ipKey, {
          failures: nextIp,
          windowStart: windowStartFor(ipKey, now),
        });
        return {
          outcome: "allowed" as const,
          pairFailures: nextPair,
          ipFailures: nextIp,
        };
      });
    },
    commitSuccess(ipKey, pairKey, now) {
      return locked(() => {
        rows.set(pairKey, { failures: 0, windowStart: now.getTime() });
        void ipKey;
      });
    },
    purgeExpired(now, limit = LOGIN_RATE_PURGE_BATCH) {
      return locked(() => purge(now, limit));
    },
  };
}

type RawClient = {
  $executeRaw: (
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<number>;
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
};

type PrismaRateDb = {
  $transaction<T>(
    fn: (tx: RawClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

const RESERVE_TX = { maxWait: 10_000, timeout: 10_000 } as const;

export type PrismaRateLimitTimings = {
  reserveMaxWaitMs?: number;
  reserveTimeoutMs?: number;
};

type BucketRow = {
  key: string;
  failures: number;
  windowStart: Date;
};

/**
 * Si Neon no responde, el llamador debe rechazar el login.
 * Este almacén no tiene modo "seguir sin límite".
 */
export function createPrismaLoginRateLimiter(
  db: PrismaRateDb,
  timings?: PrismaRateLimitTimings,
): LoginRateLimitStore {
  const reserveTx = {
    maxWait: timings?.reserveMaxWaitMs ?? RESERVE_TX.maxWait,
    timeout: timings?.reserveTimeoutMs ?? RESERVE_TX.timeout,
  };
  async function purgeInTx(tx: RawClient, now: Date, limit: number): Promise<number> {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('login-rate-bucket-purge')) AS locked
    `;
    if (!lockRows[0]?.locked) return 0;
    const cutoff = new Date(now.getTime() - LOGIN_RATE_WINDOW_MS);
    return tx.$executeRaw`
      DELETE FROM "LoginRateBucket"
      WHERE "key" IN (
        SELECT "key"
        FROM "LoginRateBucket"
        WHERE "windowStart" < ${cutoff}
        ORDER BY "windowStart" ASC
        LIMIT ${limit}
      )
    `;
  }

  async function writeBucket(
    tx: RawClient,
    key: string,
    failures: number,
    windowStart: Date,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "LoginRateBucket" ("key", "failures", "windowStart", "updatedAt")
      VALUES (${key}, ${failures}, ${windowStart}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "failures" = ${failures},
        "windowStart" = ${windowStart},
        "updatedAt" = ${now}
    `;
  }

  return {
    async reserveAttempt(ipKey, pairKey, now) {
      try {
        await db.$transaction(
          (tx) => purgeInTx(tx, now, LOGIN_RATE_PURGE_BATCH),
          { maxWait: 200, timeout: 2_000 },
        );
      } catch {
        // Una limpieza lenta no debe cerrar el login ni alargar la reserva.
      }
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ipKey}))`;
        const rows = await tx.$queryRaw<BucketRow[]>`
          SELECT "key", "failures", "windowStart"
          FROM "LoginRateBucket"
          WHERE "key" IN (${ipKey}, ${pairKey})
        `;
        const byKey = new Map(rows.map((row) => [row.key, row]));
        const countOf = (key: string) => {
          const row = byKey.get(key);
          if (!row) return 0;
          const start = new Date(row.windowStart).getTime();
          if (now.getTime() - start >= LOGIN_RATE_WINDOW_MS) return 0;
          return Number(row.failures);
        };
        const pairFailures = countOf(pairKey);
        const ipFailures = countOf(ipKey);
        if (pairFailures >= LOGIN_RATE_MAX_PAIR) {
          return { outcome: "limited" as const, pairFailures, ipFailures };
        }

        const nextPair = pairFailures + 1;
        const nextIp =
          ipFailures >= LOGIN_RATE_IP_METRIC_CAP
            ? LOGIN_RATE_IP_METRIC_CAP
            : ipFailures + 1;
        for (const [key, failures] of [
          [pairKey, nextPair],
          [ipKey, nextIp],
        ] as const) {
          const existing = byKey.get(key);
          const expired =
            !existing ||
            now.getTime() - new Date(existing.windowStart).getTime() >=
              LOGIN_RATE_WINDOW_MS;
          const windowStart = expired ? now : new Date(existing.windowStart);
          await writeBucket(tx, key, failures, windowStart, now);
        }
        return {
          outcome: "allowed" as const,
          pairFailures: nextPair,
          ipFailures: nextIp,
        };
      }, reserveTx);
    },

    async commitSuccess(ipKey, pairKey, now) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ipKey}))`;
        await writeBucket(tx, pairKey, 0, now, now);
      }, reserveTx);
    },

    async purgeExpired(now, limit = LOGIN_RATE_PURGE_BATCH) {
      return db.$transaction((tx) => purgeInTx(tx, now, limit));
    },
  };
}

export function defaultLoginRateLimiter(db: PrismaClient): LoginRateLimitStore {
  return createPrismaLoginRateLimiter(db);
}
