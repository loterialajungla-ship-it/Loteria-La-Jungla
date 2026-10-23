import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  BootstrapAdminProductionError,
  parseProductionBootstrapCredentials,
  runBootstrapAdminProduction,
  type BootstrapAdminProductionDb,
} from "@/lib/dev/bootstrap-admin-production";

type User = {
  id: string;
  usuario: string;
  rol: string;
  nombre: string;
  passwordHash: string;
  activo: boolean;
};

type Audit = {
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: string | null;
};

function makeFakeDb(seed: User[] = []) {
  let users = seed.map((u) => ({ ...u }));
  let audits: Audit[] = [];
  const stats = {
    createCalls: 0,
    auditCreates: 0,
    updateCalls: 0,
  };
  let failAudit = false;
  /** Fila de otra TX: sobrevive al rollback del fake (como en Postgres). */
  const concurrentUsers: User[] = [];
  let raceOnCreate: User | null = null;

  function allUsers(): User[] {
    return [...users, ...concurrentUsers];
  }

  function snapshot() {
    return {
      users: users.map((u) => ({ ...u })),
      audits: audits.map((a) => ({ ...a })),
    };
  }

  function restore(s: ReturnType<typeof snapshot>) {
    users = s.users;
    audits = s.audits;
  }

  const api: BootstrapAdminProductionDb & {
    stats: typeof stats;
    audits: Audit[];
    users: User[];
    setFailAudit: (v: boolean) => void;
    armCreateRace: (row: User) => void;
  } = {
    get stats() {
      return stats;
    },
    get audits() {
      return audits;
    },
    get users() {
      return allUsers();
    },
    setFailAudit(v: boolean) {
      failAudit = v;
    },
    armCreateRace(row: User) {
      raceOnCreate = { ...row };
    },
    usuario: {
      async findFirst(args: {
        where: { rol: "ADMIN" };
        select: { id: true; usuario: true };
      }) {
        const u = allUsers().find((x) => x.rol === args.where.rol);
        return u ? { id: u.id, usuario: u.usuario } : null;
      },
      async findUnique(args: {
        where: { usuario: string };
        select: { id: true; usuario: true; rol: true };
      }) {
        const u = allUsers().find((x) => x.usuario === args.where.usuario);
        return u
          ? { id: u.id, usuario: u.usuario, rol: u.rol }
          : null;
      },
      async create(args: {
        data: {
          nombre: string;
          usuario: string;
          passwordHash: string;
          rol: "ADMIN";
          activo: true;
        };
        select: { id: true; usuario: true; rol: true };
      }) {
        stats.createCalls += 1;
        if (raceOnCreate) {
          const raced = raceOnCreate;
          raceOnCreate = null;
          concurrentUsers.push(raced);
          throw new Prisma.PrismaClientKnownRequestError("Unique", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        if (allUsers().some((u) => u.usuario === args.data.usuario)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        const row: User = {
          id: `id-${args.data.usuario}`,
          usuario: args.data.usuario,
          rol: args.data.rol,
          nombre: args.data.nombre,
          passwordHash: args.data.passwordHash,
          activo: true,
        };
        users.push(row);
        return { id: row.id, usuario: row.usuario, rol: row.rol };
      },
    },
    auditoria: {
      async create(args: {
        data: {
          usuarioId: string | null;
          accion: string;
          entidad: string;
          entidadId: string;
          detalle: string | null;
        };
      }) {
        stats.auditCreates += 1;
        if (failAudit) throw new Error("audit failed");
        audits.push({ ...args.data, accion: String(args.data.accion) });
        return { id: `a-${audits.length}` };
      },
    },
    async $transaction<T>(
      fn: (tx: BootstrapAdminProductionDb) => Promise<T>,
    ): Promise<T> {
      const snap = snapshot();
      try {
        return await fn(api);
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
  };

  return api;
}

describe("parseProductionBootstrapCredentials", () => {
  it("rechaza password ausente", () => {
    assert.throws(
      () =>
        parseProductionBootstrapCredentials({
          ADMIN_BOOTSTRAP_USER: "admin",
        }),
      (e: unknown) =>
        e instanceof BootstrapAdminProductionError &&
        e.code === "MISSING_PASSWORD",
    );
  });

  it("rechaza password corta", () => {
    assert.throws(
      () =>
        parseProductionBootstrapCredentials({
          ADMIN_BOOTSTRAP_USER: "admin",
          ADMIN_BOOTSTRAP_PASSWORD: "corta",
        }),
      (e: unknown) =>
        e instanceof BootstrapAdminProductionError &&
        e.code === "INVALID_PASSWORD",
    );
  });

  it("rechaza usuario inválido", () => {
    assert.throws(
      () =>
        parseProductionBootstrapCredentials({
          ADMIN_BOOTSTRAP_USER: "ab",
          ADMIN_BOOTSTRAP_PASSWORD: "password12",
        }),
      (e: unknown) =>
        e instanceof BootstrapAdminProductionError &&
        e.code === "INVALID_USER",
    );
  });

  it("normaliza usuario válido", () => {
    const c = parseProductionBootstrapCredentials({
      ADMIN_BOOTSTRAP_USER: "  Admin.One  ",
      ADMIN_BOOTSTRAP_PASSWORD: "password12",
    });
    assert.equal(c.usuario, "admin.one");
  });
});

describe("runBootstrapAdminProduction", () => {
  it("crea ADMIN y audita CREAR_ADMIN en TX (usuarioId null)", async () => {
    const db = makeFakeDb();
    const result = await runBootstrapAdminProduction(
      db,
      { usuario: "admin", password: "password12" },
      { hashPassword: async () => "hash-fake" },
    );
    assert.equal(result.status, "created");
    if (result.status === "created") {
      assert.equal(result.usuario, "admin");
    }
    assert.equal(db.stats.createCalls, 1);
    assert.equal(db.stats.auditCreates, 1);
    assert.equal(db.audits[0]!.accion, "CREAR_ADMIN");
    assert.equal(db.audits[0]!.usuarioId, null);
    assert.equal(db.users[0]!.passwordHash, "hash-fake");
    assert.doesNotMatch(JSON.stringify(db.audits), /password12|hash-fake/);
  });

  it("si falla la auditoría revierte la creación", async () => {
    const db = makeFakeDb();
    db.setFailAudit(true);
    await assert.rejects(
      () =>
        runBootstrapAdminProduction(
          db,
          { usuario: "admin", password: "password12" },
          { hashPassword: async () => "hash-fake" },
        ),
      /audit failed/,
    );
    assert.equal(db.users.length, 0);
    assert.equal(db.audits.length, 0);
  });

  it("ADMIN ya existente → already_exists y cero escrituras", async () => {
    const db = makeFakeDb([
      {
        id: "a1",
        usuario: "root",
        rol: "ADMIN",
        nombre: "X",
        passwordHash: "h",
        activo: true,
      },
    ]);
    const result = await runBootstrapAdminProduction(
      db,
      { usuario: "admin", password: "password12" },
      { hashPassword: async () => {
        throw new Error("no debe hashear");
      } },
    );
    assert.equal(result.status, "already_exists");
    assert.equal(db.stats.createCalls, 0);
    assert.equal(db.stats.auditCreates, 0);
  });

  it("login ocupado por no-ADMIN → aborta sin modificar", async () => {
    const db = makeFakeDb([
      {
        id: "v1",
        usuario: "admin",
        rol: "VENDEDOR",
        nombre: "V",
        passwordHash: "h",
        activo: true,
      },
    ]);
    await assert.rejects(
      () =>
        runBootstrapAdminProduction(
          db,
          { usuario: "admin", password: "password12" },
          { hashPassword: async () => "hash-fake" },
        ),
      (e: unknown) =>
        e instanceof BootstrapAdminProductionError &&
        e.code === "ROLE_CONFLICT",
    );
    assert.equal(db.users[0]!.rol, "VENDEDOR");
    assert.equal(db.users[0]!.passwordHash, "h");
    assert.equal(db.stats.createCalls, 0);
  });

  it("P2002 con ADMIN concurrente → already_exists", async () => {
    const db = makeFakeDb();
    db.armCreateRace({
      id: "race-admin",
      usuario: "other",
      rol: "ADMIN",
      nombre: "A",
      passwordHash: "x",
      activo: true,
    });
    const result = await runBootstrapAdminProduction(
      db,
      { usuario: "admin", password: "password12" },
      { hashPassword: async () => "hash-fake" },
    );
    assert.equal(result.status, "already_exists");
    assert.equal(result.usuario, "other");
    assert.equal(db.stats.auditCreates, 0);
  });

  it("error inesperado no se reporta como éxito", async () => {
    const db = makeFakeDb();
    await assert.rejects(
      () =>
        runBootstrapAdminProduction(
          db,
          { usuario: "admin", password: "password12" },
          {
            hashPassword: async () => {
              throw new Error("hash boom");
            },
          },
        ),
      /hash boom/,
    );
    assert.equal(db.stats.createCalls, 0);
  });
});
