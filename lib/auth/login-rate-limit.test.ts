import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginWithCredentials } from "@/lib/auth/login";
import {
  LOGIN_DUMMY_BCRYPT_HASH,
  LOGIN_RATE_DEV_IP_ENV,
  LOGIN_RATE_IP_METRIC_CAP,
  LOGIN_RATE_MAX_PAIR,
  LOGIN_RATE_WINDOW_MS,
  createMemoryLoginRateLimiter,
  loginRateKeys,
  readLoginRateSecret,
  resolveLoginClientIp,
} from "@/lib/auth/login-rate-limit";

const SECRET = "unit-test-login-rate-limit-secret-ok";
const PASSWORD = "clave-secreta-99";
const REAL_HASH = "$2b$12$real-hash-no-es-bcrypt-valido";

type AuditRow = {
  accion: string;
  detalle: string | null;
  usuarioId: string | null;
};

function userRow(overrides?: { activo?: boolean; passwordHash?: string }) {
  return {
    id: "user-1",
    nombre: "Admin",
    usuario: "admin",
    rol: "ADMIN" as const,
    activo: overrides?.activo ?? true,
    passwordHash: overrides?.passwordHash ?? REAL_HASH,
  };
}

function fakeDb(row: ReturnType<typeof userRow> | null) {
  const audits: AuditRow[] = [];
  let sessions = 0;
  const db = {
    usuario: {
      findUnique: async () => row,
      update: async () => row,
    },
    usuarioSesion: {
      create: async () => {
        sessions += 1;
        return {
          id: "sesion-1",
          tokenHash: "hash-de-sesion",
          expiresAt: new Date(),
        };
      },
    },
    auditoria: {
      create: async (args: { data: AuditRow }) => {
        audits.push(args.data);
      },
    },
  };
  return {
    db: db as never,
    audits,
    sessions: () => sessions,
  };
}

function verifier(matchHash: string, acceptPassword = PASSWORD) {
  const calls: string[] = [];
  const verify = async (password: string, hash: string) => {
    calls.push(hash);
    return hash === matchHash && password === acceptPassword;
  };
  return { verify, calls };
}

async function attempt(args: {
  usuario: string;
  password?: string;
  ip?: string;
  row?: ReturnType<typeof userRow> | null;
  store?: ReturnType<typeof createMemoryLoginRateLimiter>;
  verify?: (password: string, hash: string) => Promise<boolean>;
  ahora?: Date;
  secret?: string;
  reserveThrows?: boolean;
  omitIp?: boolean;
}) {
  const bag = fakeDb(args.row === undefined ? null : args.row);
  const store = args.store ?? createMemoryLoginRateLimiter();
  const rateLimit = args.reserveThrows
    ? {
        reserveAttempt: async () => {
          throw new Error("neon-down");
        },
        commitSuccess: async () => {
          throw new Error("neon-down");
        },
        purgeExpired: async () => {
          throw new Error("neon-down");
        },
      }
    : store;
  const result = await loginWithCredentials(
    bag.db,
    {
      usuario: args.usuario,
      password: args.password ?? PASSWORD,
      clientIp: args.omitIp ? undefined : (args.ip ?? "203.0.113.20"),
      rateLimitSecret: args.secret ?? SECRET,
      rateLimit,
      verifyPassword: args.verify,
    },
    args.ahora,
  );
  return { result, ...bag, store };
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://loteria.example/api/admin/login", { headers });
}

describe("login rate limit y enumeración", () => {
  it("el hash ficticio es bcrypt de coste 12 y es fijo", () => {
    assert.match(LOGIN_DUMMY_BCRYPT_HASH, /^\$2[aby]\$12\$/);
    assert.equal(
      LOGIN_DUMMY_BCRYPT_HASH,
      "$2b$12$iIjLt1TVl6zViSO2vPPN2OQKAgnCT53E63rfuZMF9p2blSlcpkC.G",
    );
  });

  it("usuario inexistente verifica el hash ficticio y devuelve null", async () => {
    const spy = verifier(REAL_HASH);
    const out = await attempt({
      usuario: "nadie",
      row: null,
      verify: spy.verify,
    });
    assert.equal(out.result, null);
    assert.deepEqual(spy.calls, [LOGIN_DUMMY_BCRYPT_HASH]);
    assert.equal(out.sessions(), 0);
  });

  it("usuario inactivo verifica el hash ficticio, no el real", async () => {
    const spy = verifier(REAL_HASH);
    const out = await attempt({
      usuario: "admin",
      row: userRow({ activo: false }),
      verify: spy.verify,
    });
    assert.equal(out.result, null);
    assert.deepEqual(spy.calls, [LOGIN_DUMMY_BCRYPT_HASH]);
    assert.equal(out.sessions(), 0);
  });

  it("contraseña incorrecta verifica el hash real", async () => {
    const spy = verifier(REAL_HASH, "otra-clave");
    const out = await attempt({
      usuario: "admin",
      password: PASSWORD,
      row: userRow(),
      verify: spy.verify,
    });
    assert.equal(out.result, null);
    assert.deepEqual(spy.calls, [REAL_HASH]);
  });

  it("los tres fallos de credencial son null, sin sesión", async () => {
    const missing = await attempt({
      usuario: "no",
      row: null,
      verify: async () => false,
    });
    const inactive = await attempt({
      usuario: "admin",
      row: userRow({ activo: false }),
      verify: async () => false,
    });
    const bad = await attempt({
      usuario: "admin",
      row: userRow(),
      verify: async () => false,
    });
    assert.equal(missing.result, null);
    assert.equal(inactive.result, null);
    assert.equal(bad.result, null);
    assert.equal(missing.sessions() + inactive.sessions() + bad.sessions(), 0);
  });

  it("cinco reservas y la sexta no ejecuta bcrypt", async () => {
    const store = createMemoryLoginRateLimiter();
    let verifies = 0;
    const verify = async () => {
      verifies += 1;
      return false;
    };
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR; i += 1) {
      const out = await attempt({
        usuario: "admin",
        row: userRow(),
        store,
        verify,
      });
      assert.equal(out.result, null);
    }
    assert.equal(verifies, LOGIN_RATE_MAX_PAIR);
    const blocked = await attempt({
      usuario: "admin",
      password: PASSWORD,
      row: userRow(),
      store,
      verify: async () => {
        verifies += 1;
        return true;
      },
    });
    assert.equal(blocked.result, null);
    assert.equal(blocked.sessions(), 0);
    assert.equal(verifies, LOGIN_RATE_MAX_PAIR);
    assert.equal(blocked.audits.length, 0);
  });

  it("el agregado por IP no bloquea otra cuenta con contraseña correcta", async () => {
    const store = createMemoryLoginRateLimiter();
    for (let i = 0; i < LOGIN_RATE_IP_METRIC_CAP + 5; i += 1) {
      await attempt({
        usuario: `vend${i}`,
        ip: "203.0.113.77",
        row: null,
        store,
        verify: async () => false,
      });
    }
    const ok = await attempt({
      usuario: "admin",
      ip: "203.0.113.77",
      row: userRow(),
      store,
      verify: async (password, hash) =>
        password === PASSWORD && hash === REAL_HASH,
    });
    assert.ok(ok.result);
    assert.equal(ok.sessions(), 1);
  });

  it("mayúsculas y espacios no evaden el límite de pareja", async () => {
    const store = createMemoryLoginRateLimiter();
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR; i += 1) {
      await attempt({
        usuario: " Admin ",
        row: userRow(),
        store,
        verify: async () => false,
      });
    }
    let verifies = 0;
    const blocked = await attempt({
      usuario: "admin",
      row: userRow(),
      store,
      verify: async () => {
        verifies += 1;
        return true;
      },
    });
    assert.equal(blocked.result, null);
    assert.equal(blocked.sessions(), 0);
    assert.equal(verifies, 0);
  });

  it("un login correcto reinicia el contador de esa pareja", async () => {
    const store = createMemoryLoginRateLimiter();
    for (let i = 0; i < 3; i += 1) {
      await attempt({
        usuario: "admin",
        row: userRow(),
        store,
        verify: async () => false,
      });
    }
    const ok = await attempt({
      usuario: "admin",
      row: userRow(),
      store,
      verify: async (password, hash) =>
        password === PASSWORD && hash === REAL_HASH,
    });
    assert.ok(ok.result);
    assert.equal(ok.sessions(), 1);
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR; i += 1) {
      const still = await attempt({
        usuario: "admin",
        row: userRow(),
        store,
        verify: async () => false,
      });
      assert.equal(still.result, null);
    }
    let verifies = 0;
    const again = await attempt({
      usuario: "admin",
      row: userRow(),
      store,
      verify: async () => {
        verifies += 1;
        return true;
      },
    });
    assert.equal(again.result, null);
    assert.equal(verifies, 0);
  });

  it("una ráfaga en memoria no reserva más de cinco intentos", async () => {
    const store = createMemoryLoginRateLimiter();
    const keys = loginRateKeys(SECRET, "203.0.113.8", "admin");
    const now = new Date("2026-11-07T12:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        store.reserveAttempt(keys.ipKey, keys.pairKey, now),
      ),
    );
    const allowed = results.filter((item) => item.outcome === "allowed");
    assert.equal(allowed.length, LOGIN_RATE_MAX_PAIR);
    assert.equal(
      results.filter((item) => item.outcome === "limited").length,
      7,
    );
  });

  it("la ventana caduca y vuelve a permitir el login", async () => {
    const store = createMemoryLoginRateLimiter();
    const start = new Date("2026-11-07T12:00:00.000Z");
    for (let i = 0; i < LOGIN_RATE_MAX_PAIR; i += 1) {
      await attempt({
        usuario: "admin",
        row: userRow(),
        store,
        ahora: start,
        verify: async () => false,
      });
    }
    const later = new Date(start.getTime() + LOGIN_RATE_WINDOW_MS + 1000);
    const ok = await attempt({
      usuario: "admin",
      row: userRow(),
      store,
      ahora: later,
      verify: async () => true,
    });
    assert.ok(ok.result);
    assert.equal(ok.sessions(), 1);
  });

  it("la limpieza borra ventanas vencidas y conserva las activas", async () => {
    const store = createMemoryLoginRateLimiter();
    const start = new Date("2026-11-07T12:00:00.000Z");
    const oldKeys = loginRateKeys(SECRET, "203.0.113.1", "viejo");
    const liveKeys = loginRateKeys(SECRET, "203.0.113.2", "vivo");
    await store.reserveAttempt(oldKeys.ipKey, oldKeys.pairKey, start);
    const whileOldIsActive = new Date(start.getTime() + LOGIN_RATE_WINDOW_MS - 60_000);
    await store.reserveAttempt(liveKeys.ipKey, liveKeys.pairKey, whileOldIsActive);
    const later = new Date(start.getTime() + LOGIN_RATE_WINDOW_MS + 1000);
    const removed = await store.purgeExpired(later, 10);
    assert.equal(removed, 2);
    const still = await store.reserveAttempt(liveKeys.ipKey, liveKeys.pairKey, later);
    assert.equal(still.outcome, "allowed");
    assert.equal(still.pairFailures, 2);
  });

  it("la auditoría del fallo no guarda contraseña ni token", async () => {
    const out = await attempt({
      usuario: "admin",
      password: PASSWORD,
      row: userRow(),
      verify: async () => false,
    });
    assert.equal(out.audits.length, 1);
    const row = out.audits[0]!;
    assert.equal(row.accion, "LOGIN_FALLIDO");
    const raw = JSON.stringify(row);
    assert.equal(raw.includes(PASSWORD), false);
    assert.equal(raw.includes(REAL_HASH), false);
    assert.equal(raw.includes(SECRET), false);
    assert.equal(raw.includes("token"), false);
    const detalle = JSON.parse(row.detalle ?? "{}") as { motivo?: string };
    assert.equal(detalle.motivo, "bad_password");
  });

  it("si el almacén falla, no hay sesión aunque la contraseña sea buena", async () => {
    let verifies = 0;
    const out = await attempt({
      usuario: "admin",
      row: userRow(),
      reserveThrows: true,
      verify: async () => {
        verifies += 1;
        return true;
      },
    });
    assert.equal(out.result, null);
    assert.equal(out.sessions(), 0);
    assert.equal(verifies, 0);
  });

  it("sin secreto de límite el login no se abre y el log no incluye el valor", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((item) => JSON.stringify(item)).join(" "));
    };
    try {
      const out = await attempt({
        usuario: "admin",
        row: userRow(),
        secret: "valor-no-publicable",
        verify: async () => true,
      });
      assert.equal(out.result, null);
      assert.equal(out.sessions(), 0);
      assert.equal(lines.join("\n").includes("valor-no-publicable"), false);
      assert.equal(lines.join("\n").includes(PASSWORD), false);
    } finally {
      console.error = original;
    }
  });

  it("rechaza el secreto de login cuando es igual a CRON_SECRET", () => {
    const shared = "mismo-secreto-de-32-caracteres-min";
    assert.throws(() =>
      readLoginRateSecret({
        LOGIN_RATE_LIMIT_SECRET: shared,
        CRON_SECRET: shared,
      }),
    );
    assert.equal(
      readLoginRateSecret({
        LOGIN_RATE_LIMIT_SECRET: SECRET,
        CRON_SECRET: "otro-secreto-distinto-de-32-caracteres",
      }),
      SECRET,
    );
  });

  it("sin IP confiable no reserva un cubo compartido", async () => {
    const store = createMemoryLoginRateLimiter();
    let reserves = 0;
    const out = await attempt({
      usuario: "admin",
      row: userRow(),
      omitIp: true,
      store: {
        reserveAttempt: async () => {
          reserves += 1;
          return store.reserveAttempt("ip:x", "pair:x", new Date());
        },
        commitSuccess: store.commitSuccess.bind(store),
        purgeExpired: store.purgeExpired.bind(store),
      },
      verify: async () => true,
    });
    assert.equal(out.result, null);
    assert.equal(out.sessions(), 0);
    assert.equal(reserves, 0);
  });

  it("en Vercel usa la cabecera de plataforma y no X-Forwarded-For", () => {
    const trusted = resolveLoginClientIp(
      requestWith({
        "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.8",
        "x-forwarded-for": "198.51.100.4",
        "x-real-ip": "198.51.100.5",
      }),
      { VERCEL: "1", NODE_ENV: "production" },
    );
    assert.deepEqual(trusted, { status: "trusted", ip: "203.0.113.9" });

    const realOnly = resolveLoginClientIp(
      requestWith({ "x-real-ip": "203.0.113.15" }),
      { VERCEL: "1", NODE_ENV: "production" },
    );
    assert.deepEqual(realOnly, { status: "trusted", ip: "203.0.113.15" });

    const spoofed = resolveLoginClientIp(
      requestWith({ "x-forwarded-for": "198.51.100.4" }),
      { VERCEL: "1", NODE_ENV: "production" },
    );
    assert.deepEqual(spoofed, { status: "rejected" });

    const missing = resolveLoginClientIp(requestWith({}), {
      VERCEL: "1",
      NODE_ENV: "production",
    });
    assert.deepEqual(missing, { status: "rejected" });
  });

  it("el puesto de desarrollo no se activa en producción ni acepta cabeceras del cliente", () => {
    const dev = resolveLoginClientIp(
      requestWith({
        "x-forwarded-for": "198.51.100.9",
        "x-real-ip": "198.51.100.8",
      }),
      {
        NODE_ENV: "development",
        [LOGIN_RATE_DEV_IP_ENV]: "Dev-Local",
      },
    );
    assert.deepEqual(dev, { status: "dev", ip: "dev-local" });

    const productionIgnoresDev = resolveLoginClientIp(
      requestWith({
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.20",
      }),
      {
        NODE_ENV: "production",
        [LOGIN_RATE_DEV_IP_ENV]: "dev-local",
      },
    );
    assert.deepEqual(productionIgnoresDev, { status: "rejected" });

    const vercelEnvIgnoresDev = resolveLoginClientIp(
      requestWith({ "x-forwarded-for": "198.51.100.21" }),
      {
        NODE_ENV: "development",
        VERCEL_ENV: "production",
        [LOGIN_RATE_DEV_IP_ENV]: "dev-local",
      },
    );
    assert.deepEqual(vercelEnvIgnoresDev, { status: "rejected" });
  });
});
