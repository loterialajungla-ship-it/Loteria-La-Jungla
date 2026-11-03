import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRODUCTION_ADMIN_LOGIN_TARGET,
  RenameAdminLoginProductionError,
  parseRenameAdminLoginTarget,
  resolveSingleActiveAdmin,
  runRenameAdminLoginProduction,
  type RenameAdminLoginProductionDb,
} from "@/lib/dev/rename-admin-login-production";

type User = {
  id: string;
  usuario: string;
  rol: string;
  activo: boolean;
  passwordHash: string;
  nombre: string;
};

function makeFakeDb(seed: User[]) {
  let users = seed.map((u) => ({ ...u }));
  const stats = { updateCalls: 0, createCalls: 0 };

  function snapshot() {
    return users.map((u) => ({ ...u }));
  }
  function restore(s: User[]) {
    users = s.map((u) => ({ ...u }));
  }

  const api: RenameAdminLoginProductionDb & {
    stats: typeof stats;
    users: User[];
  } = {
    get stats() {
      return stats;
    },
    get users() {
      return users;
    },
    usuario: {
      async findMany(args: {
        where: { rol: "ADMIN"; activo: true };
        select: {
          id: true;
          usuario: true;
          rol: true;
          activo: true;
          passwordHash: true;
          nombre: true;
        };
      }) {
        return users
          .filter(
            (u) =>
              u.rol === args.where.rol && u.activo === args.where.activo,
          )
          .map((u) => ({ ...u }));
      },
      async findUnique(args: {
        where: { usuario: string };
        select: { id: true; usuario: true; rol: true };
      }) {
        const u = users.find((x) => x.usuario === args.where.usuario);
        return u
          ? { id: u.id, usuario: u.usuario, rol: u.rol }
          : null;
      },
      async update(args: {
        where: { id: string };
        data: { usuario: string };
        select: {
          id: true;
          usuario: true;
          rol: true;
          activo: true;
          passwordHash: true;
          nombre: true;
        };
      }) {
        stats.updateCalls += 1;
        const idx = users.findIndex((u) => u.id === args.where.id);
        if (idx < 0) throw new Error("missing");
        users[idx] = { ...users[idx]!, usuario: args.data.usuario };
        return { ...users[idx]! };
      },
    },
    async $transaction(fn) {
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

describe("parseRenameAdminLoginTarget", () => {
  it("default y normalización a adminlajungla", () => {
    assert.equal(parseRenameAdminLoginTarget({}), PRODUCTION_ADMIN_LOGIN_TARGET);
    assert.equal(
      parseRenameAdminLoginTarget({
        RENAME_ADMIN_LOGIN_NEW_USER: " AdminLaJungla ",
      }),
      "adminlajungla",
    );
  });

  it("rechaza otros logins", () => {
    assert.throws(
      () =>
        parseRenameAdminLoginTarget({
          RENAME_ADMIN_LOGIN_NEW_USER: "otro",
        }),
      /adminlajungla/,
    );
  });
});

describe("runRenameAdminLoginProduction", () => {
  const admin: User = {
    id: "a1",
    usuario: "admin_pw",
    rol: "ADMIN",
    activo: true,
    passwordHash: "hash-keep",
    nombre: "Administrador",
  };
  const vendor: User = {
    id: "v1",
    usuario: "vendedor1",
    rol: "VENDEDOR",
    activo: true,
    passwordHash: "vh",
    nombre: "V",
  };

  it("renombra solo usuario; conserva hash/rol/activo/nombre/id", async () => {
    const db = makeFakeDb([admin, vendor]);
    const result = await runRenameAdminLoginProduction(
      db,
      PRODUCTION_ADMIN_LOGIN_TARGET,
    );
    assert.equal(result.status, "renamed");
    if (result.status === "renamed") {
      assert.equal(result.usuarioNuevo, "adminlajungla");
      assert.equal(result.usuarioAnterior, "admin_pw");
    }
    const row = db.users.find((u) => u.id === "a1")!;
    assert.equal(row.usuario, "adminlajungla");
    assert.equal(row.passwordHash, "hash-keep");
    assert.equal(row.rol, "ADMIN");
    assert.equal(row.activo, true);
    assert.equal(row.nombre, "Administrador");
    assert.equal(db.users.find((u) => u.id === "v1")!.usuario, "vendedor1");
  });

  it("already_target sin escritura", async () => {
    const db = makeFakeDb([
      { ...admin, usuario: "adminlajungla" },
      vendor,
    ]);
    const result = await runRenameAdminLoginProduction(
      db,
      PRODUCTION_ADMIN_LOGIN_TARGET,
    );
    assert.equal(result.status, "already_target");
    assert.equal(db.stats.updateCalls, 0);
  });

  it("aborta con 0 o 2 ADMIN activos", async () => {
    await assert.rejects(
      () =>
        runRenameAdminLoginProduction(
          makeFakeDb([vendor]),
          PRODUCTION_ADMIN_LOGIN_TARGET,
        ),
      /no hay un ADMIN/,
    );
    await assert.rejects(
      () =>
        runRenameAdminLoginProduction(
          makeFakeDb([
            admin,
            { ...admin, id: "a2", usuario: "admin2" },
          ]),
          PRODUCTION_ADMIN_LOGIN_TARGET,
        ),
      /más de un ADMIN/,
    );
  });

  it("aborta si el login está ocupado", async () => {
    const db = makeFakeDb([
      admin,
      { ...vendor, usuario: "adminlajungla" },
    ]);
    await assert.rejects(
      () => runRenameAdminLoginProduction(db, PRODUCTION_ADMIN_LOGIN_TARGET),
      /ocupado/,
    );
    assert.equal(db.users.find((u) => u.id === "a1")!.usuario, "admin_pw");
  });

  it("resolveSingleActiveAdmin rechaza vacío", () => {
    assert.throws(() => resolveSingleActiveAdmin([]), RenameAdminLoginProductionError);
  });
});
