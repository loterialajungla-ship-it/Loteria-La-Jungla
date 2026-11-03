import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ResetAdminPasswordProductionError,
  parseProductionAdminPasswordResetInput,
  resolveProductionAdminPasswordResetTarget,
  runResetAdminPasswordProduction,
  type ResetAdminPasswordProductionDb,
} from "@/lib/dev/reset-admin-password-production";

type User = {
  id: string;
  usuario: string;
  rol: string;
  nombre: string;
  passwordHash: string;
  activo: boolean;
};

type Session = {
  id: string;
  usuarioId: string;
};

type Audit = {
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle: string | null;
};

const SECRET_PASSWORD = "new-secret-99";
const OLD_HASH = "hash-old";
const NEW_HASH = "hash-new-fake";

function assertNoSecrets(text: string): void {
  assert.equal(text.includes(SECRET_PASSWORD), false);
  assert.equal(text.includes(OLD_HASH), false);
  assert.equal(text.includes(NEW_HASH), false);
  assert.doesNotMatch(text, /passwordHash/i);
}

function makeFakeDb(seedUsers: User[] = [], seedSessions: Session[] = []) {
  let users = seedUsers.map((u) => ({ ...u }));
  let sessions = seedSessions.map((s) => ({ ...s }));
  let audits: Audit[] = [];
  const stats = {
    updateCalls: 0,
    deleteSessionCalls: 0,
    auditCreates: 0,
  };
  let failAudit = false;

  function snapshot() {
    return {
      users: users.map((u) => ({ ...u })),
      sessions: sessions.map((s) => ({ ...s })),
      audits: audits.map((a) => ({ ...a })),
    };
  }

  function restore(s: ReturnType<typeof snapshot>) {
    users = s.users;
    sessions = s.sessions;
    audits = s.audits;
  }

  const api: ResetAdminPasswordProductionDb & {
    stats: typeof stats;
    users: User[];
    sessions: Session[];
    audits: Audit[];
    setFailAudit: (v: boolean) => void;
  } = {
    get stats() {
      return stats;
    },
    get users() {
      return users;
    },
    get sessions() {
      return sessions;
    },
    get audits() {
      return audits;
    },
    setFailAudit(v: boolean) {
      failAudit = v;
    },
    usuario: {
      async findMany(args: {
        where: { usuario: string };
        select: {
          id: true;
          usuario: true;
          rol: true;
          activo: true;
        };
      }) {
        return users
          .filter((u) => u.usuario === args.where.usuario)
          .map((u) => ({
            id: u.id,
            usuario: u.usuario,
            rol: u.rol,
            activo: u.activo,
          }));
      },
      async update(args: {
        where: { id: string };
        data: { passwordHash: string };
        select: { id: true; usuario: true };
      }) {
        stats.updateCalls += 1;
        const idx = users.findIndex((u) => u.id === args.where.id);
        if (idx < 0) throw new Error("user missing");
        users[idx] = {
          ...users[idx]!,
          passwordHash: args.data.passwordHash,
        };
        return { id: users[idx]!.id, usuario: users[idx]!.usuario };
      },
    },
    usuarioSesion: {
      async deleteMany(args: { where: { usuarioId: string } }) {
        stats.deleteSessionCalls += 1;
        const before = sessions.length;
        sessions = sessions.filter(
          (s) => s.usuarioId !== args.where.usuarioId,
        );
        return { count: before - sessions.length };
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
        if (failAudit) throw new Error("audit boom");
        stats.auditCreates += 1;
        audits.push({
          usuarioId: args.data.usuarioId,
          accion: String(args.data.accion),
          entidad: String(args.data.entidad),
          entidadId: args.data.entidadId,
          detalle: args.data.detalle,
        });
        return { id: "a1" };
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

describe("parseProductionAdminPasswordResetInput", () => {
  it("exige usuario y password; normaliza login", () => {
    const parsed = parseProductionAdminPasswordResetInput({
      ADMIN_PASSWORD_RESET_USER: "  AdminOne ",
      ADMIN_PASSWORD_RESET_PASSWORD: SECRET_PASSWORD,
    });
    assert.equal(parsed.usuario, "adminone");
    assert.equal(parsed.password, SECRET_PASSWORD);
  });

  it("aborta sin usuario, sin password o password corta; sin secretos en mensaje", () => {
    for (const env of [
      {},
      { ADMIN_PASSWORD_RESET_USER: "admin" },
      {
        ADMIN_PASSWORD_RESET_USER: "admin",
        ADMIN_PASSWORD_RESET_PASSWORD: "short",
      },
      {
        ADMIN_PASSWORD_RESET_USER: "!!",
        ADMIN_PASSWORD_RESET_PASSWORD: SECRET_PASSWORD,
      },
    ]) {
      assert.throws(
        () => parseProductionAdminPasswordResetInput(env),
        (e: unknown) => {
          assert.ok(e instanceof ResetAdminPasswordProductionError);
          assertNoSecrets(e.message);
          return true;
        },
      );
    }
  });

  it("no usa default de password ni de usuario", () => {
    assert.throws(
      () =>
        parseProductionAdminPasswordResetInput({
          ADMIN_PASSWORD_RESET_PASSWORD: SECRET_PASSWORD,
        }),
      /ADMIN_PASSWORD_RESET_USER/,
    );
  });
});

describe("resolveProductionAdminPasswordResetTarget", () => {
  it("exige exactamente un ADMIN activo", () => {
    assert.throws(
      () => resolveProductionAdminPasswordResetTarget([]),
      /no hay un usuario/,
    );
    assert.throws(
      () =>
        resolveProductionAdminPasswordResetTarget([
          {
            id: "1",
            usuario: "a",
            rol: "ADMIN",
            activo: true,
          },
          {
            id: "2",
            usuario: "a",
            rol: "ADMIN",
            activo: true,
          },
        ]),
      /más de un usuario/,
    );
    assert.throws(
      () =>
        resolveProductionAdminPasswordResetTarget([
          {
            id: "1",
            usuario: "vend",
            rol: "VENDEDOR",
            activo: true,
          },
        ]),
      /no tiene rol ADMIN/,
    );
    assert.throws(
      () =>
        resolveProductionAdminPasswordResetTarget([
          {
            id: "1",
            usuario: "admin",
            rol: "ADMIN",
            activo: false,
          },
        ]),
      /no está activo/,
    );
  });
});

describe("runResetAdminPasswordProduction", () => {
  const admin: User = {
    id: "adm-1",
    usuario: "admin",
    rol: "ADMIN",
    nombre: "Administrador",
    passwordHash: OLD_HASH,
    activo: true,
  };
  const vendor: User = {
    id: "ven-1",
    usuario: "vendedor1",
    rol: "VENDEDOR",
    nombre: "V",
    passwordHash: "vh",
    activo: true,
  };

  it("actualiza solo el hash del ADMIN, invalida solo sus sesiones y audita sin secretos", async () => {
    const db = makeFakeDb(
      [admin, vendor],
      [
        { id: "s1", usuarioId: "adm-1" },
        { id: "s2", usuarioId: "adm-1" },
        { id: "s3", usuarioId: "ven-1" },
      ],
    );

    const result = await runResetAdminPasswordProduction(
      db,
      { usuario: "admin", password: SECRET_PASSWORD },
      { hashPassword: async () => NEW_HASH },
    );

    assert.equal(result.status, "reset");
    assert.equal(result.usuario, "admin");
    assert.equal(result.sessionsInvalidated, 2);
    assert.equal(db.users.length, 2);
    assert.equal(db.stats.updateCalls, 1);
    assert.equal(db.users.find((u) => u.id === "adm-1")!.passwordHash, NEW_HASH);
    assert.equal(db.users.find((u) => u.id === "ven-1")!.passwordHash, "vh");
    assert.equal(db.users.find((u) => u.id === "adm-1")!.usuario, "admin");
    assert.equal(db.users.find((u) => u.id === "adm-1")!.rol, "ADMIN");
    assert.equal(db.users.find((u) => u.id === "adm-1")!.activo, true);
    assert.equal(db.users.find((u) => u.id === "adm-1")!.nombre, "Administrador");
    assert.equal(db.sessions.length, 1);
    assert.equal(db.sessions[0]!.usuarioId, "ven-1");
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]!.accion, "RESET_PASSWORD");
    assert.equal(db.audits[0]!.entidad, "USUARIO");
    assert.equal(db.audits[0]!.entidadId, "adm-1");
    assert.equal(db.audits[0]!.usuarioId, null);
    assert.ok(db.audits[0]!.detalle);
    assertNoSecrets(db.audits[0]!.detalle!);
    assert.match(db.audits[0]!.detalle!, /admin_password_reset_production/);
  });

  it("nunca crea usuarios; aborta si no hay objetivo válido", async () => {
    const db = makeFakeDb([vendor]);
    await assert.rejects(
      () =>
        runResetAdminPasswordProduction(
          db,
          { usuario: "admin", password: SECRET_PASSWORD },
          { hashPassword: async () => NEW_HASH },
        ),
      /no hay un usuario/,
    );
    assert.equal(db.stats.updateCalls, 0);
    assert.equal(db.users.length, 1);
  });

  it("aborta con rol incorrecto o inactivo sin escribir", async () => {
    const inactive: User = { ...admin, activo: false };
    const asVendor: User = { ...admin, rol: "VENDEDOR" };

    for (const seed of [inactive, asVendor]) {
      const db = makeFakeDb([seed]);
      await assert.rejects(
        () =>
          runResetAdminPasswordProduction(
            db,
            { usuario: "admin", password: SECRET_PASSWORD },
            { hashPassword: async () => NEW_HASH },
          ),
      );
      assert.equal(db.stats.updateCalls, 0);
      assert.equal(db.users[0]!.passwordHash, OLD_HASH);
    }
  });

  it("fallo de auditoría revierte update y sesiones", async () => {
    const db = makeFakeDb(
      [admin],
      [
        { id: "s1", usuarioId: "adm-1" },
        { id: "s2", usuarioId: "adm-1" },
      ],
    );
    db.setFailAudit(true);

    await assert.rejects(
      () =>
        runResetAdminPasswordProduction(
          db,
          { usuario: "admin", password: SECRET_PASSWORD },
          { hashPassword: async () => NEW_HASH },
        ),
      /audit boom/,
    );

    assert.equal(db.users[0]!.passwordHash, OLD_HASH);
    assert.equal(db.sessions.length, 2);
    assert.equal(db.audits.length, 0);
  });

  it("aborta si hay más de una coincidencia de login", async () => {
    const db = makeFakeDb([
      admin,
      { ...admin, id: "adm-2", passwordHash: "other" },
    ]);
    // findMany devolverá 2 filas con mismo usuario (caso defensivo)
    await assert.rejects(
      () =>
        runResetAdminPasswordProduction(
          db,
          { usuario: "admin", password: SECRET_PASSWORD },
          { hashPassword: async () => NEW_HASH },
        ),
      /más de un usuario/,
    );
    assert.equal(db.stats.updateCalls, 0);
  });
});
