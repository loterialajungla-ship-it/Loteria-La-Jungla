/**
 * Unitarios del harness aislado — sin Neon / sin Prisma real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  CREDITOS_QA_PREFIX,
  absorbOwnedAuditorias,
  absorbRecoveredTickets,
  absorbRecoveredUsers,
  auditoriaOwnedByRun,
  buildRunPrefix,
  buildVirtualCreditosConfig,
  emptyCleanupReport,
  emptyRegistry,
  extractRunIdFromUsuarioLogin,
  runCleanupPhases,
  usuarioLoginBelongsToExactRun,
  wrapStoreWithVirtualConfig,
} from "@/lib/creditos/integration/isolated-harness";
import { createMemoryCreditosStore } from "@/lib/creditos/store";
import { getCreditosConfig } from "@/lib/creditos/config";

const RUN_A = "m1abc_a1b2c3";
const RUN_B = "m1xyz_d4e5f6";

describe("isolated-harness (unit)", () => {
  it("prefijo canónico de aislamiento", () => {
    assert.equal(CREDITOS_QA_PREFIX, "creditos_qa_");
    assert.equal(buildRunPrefix(RUN_A), `creditos_qa_${RUN_A}_`);
  });

  it("config virtual marca configPersisted sin tocar DB", () => {
    const c = buildVirtualCreditosConfig({
      controlActivo: true,
      inicioEn: new Date("2026-01-01T00:00:00.000Z"),
      umbralSaldoBajo: new Prisma.Decimal("10"),
    });
    assert.equal(c.configPersisted, true);
    assert.equal(c.controlActivo, true);
    assert.equal(c.umbralSaldoBajo?.toFixed(2), "10.00");
  });

  it("wrapStoreWithVirtualConfig: getConfig virtual y saveConfig prohibido", async () => {
    const mem = createMemoryCreditosStore();
    const virtual = buildVirtualCreditosConfig({
      controlActivo: false,
      inicioEn: null,
    });
    const wrapped = wrapStoreWithVirtualConfig(mem, virtual);
    const cfg = await getCreditosConfig(wrapped);
    assert.equal(cfg.controlActivo, false);
    assert.equal(cfg.configPersisted, true);

    await assert.rejects(
      () =>
        wrapped.saveConfig({
          controlActivo: true,
          inicioEn: new Date(),
          updatedByAdminId: "x",
        }),
      /prohibido persistir CreditosConfig/,
    );
  });

  it("wrap re-aplica virtual config dentro de runInTransaction", async () => {
    const mem = createMemoryCreditosStore();
    const virtual = buildVirtualCreditosConfig({
      controlActivo: true,
      inicioEn: new Date("2026-06-01T00:00:00.000Z"),
    });
    const wrapped = wrapStoreWithVirtualConfig(mem, virtual);
    await wrapped.runInTransaction(async (tx) => {
      const c = await tx.getConfig();
      assert.equal(c.controlActivo, true);
      await assert.rejects(() =>
        tx.saveConfig({
          controlActivo: false,
          updatedByAdminId: "a",
        }),
      );
    });
  });

  it("1) recupera usuario del run no registrado previamente", () => {
    const registry = emptyRegistry(RUN_A);
    assert.equal(registry.userIds.size, 0);
    const login = `${registry.prefix}v99aa`;
    absorbRecoveredUsers(registry, [{ id: "u-orphan", usuario: login }]);
    assert.ok(registry.userIds.has("u-orphan"));
    assert.equal(registry.userLogins.get(login), "u-orphan");
    assert.equal(extractRunIdFromUsuarioLogin(login), RUN_A);
  });

  it("2) recupera ticket creado pero no registrado en el registry", () => {
    const registry = emptyRegistry(RUN_A);
    absorbRecoveredUsers(registry, [
      { id: "vend-1", usuario: `${registry.prefix}v01` },
    ]);
    assert.equal(registry.ticketIds.size, 0);
    absorbRecoveredTickets(registry, [
      { id: "t-orphan", vendedorId: "vend-1" },
    ]);
    assert.ok(registry.ticketIds.has("t-orphan"));
  });

  it("3) excluye usuarios de otro run", () => {
    const registry = emptyRegistry(RUN_A);
    const otherPrefix = buildRunPrefix(RUN_B);
    assert.throws(
      () =>
        absorbRecoveredUsers(registry, [
          { id: "u-foreign", usuario: `${otherPrefix}v01` },
        ]),
      /ABORT recover/,
    );
    assert.equal(registry.userIds.size, 0);
    assert.equal(
      usuarioLoginBelongsToExactRun(`${otherPrefix}v01`, registry),
      false,
    );
  });

  it("4) excluye tickets de otros vendedores", () => {
    const registry = emptyRegistry(RUN_A);
    absorbRecoveredUsers(registry, [
      { id: "vend-1", usuario: `${registry.prefix}v01` },
    ]);
    assert.throws(
      () =>
        absorbRecoveredTickets(registry, [
          { id: "t-foreign", vendedorId: "vend-ajeno" },
        ]),
      /ABORT recover/,
    );
    assert.equal(registry.ticketIds.size, 0);
  });

  it("5) rechaza auditoría con entidad incompatible aunque entidadId coincida", () => {
    const registry = emptyRegistry(RUN_A);
    registry.ticketIds.add("same-id");
    registry.userIds.add("u1");
    const audit = {
      id: "aud-bad",
      entidad: "RESULTADO" as const,
      entidadId: "same-id",
      usuarioId: null,
    };
    assert.equal(auditoriaOwnedByRun(audit, registry), false);
    absorbOwnedAuditorias(registry, [audit]);
    assert.equal(registry.auditoriaIds.has("aud-bad"), false);
  });

  it("6) acepta auditoría con tipo y relación correctos", () => {
    const registry = emptyRegistry(RUN_A);
    registry.ticketIds.add("t-1");
    registry.userIds.add("u-1");
    const byTicket = {
      id: "aud-t",
      entidad: "TICKET" as const,
      entidadId: "t-1",
      usuarioId: null as string | null,
    };
    const byUserEntidad = {
      id: "aud-u",
      entidad: "USUARIO" as const,
      entidadId: "u-1",
      usuarioId: null as string | null,
    };
    const byActor = {
      id: "aud-a",
      entidad: "AUTH" as const,
      entidadId: "session-x",
      usuarioId: "u-1",
    };
    assert.equal(auditoriaOwnedByRun(byTicket, registry), true);
    assert.equal(auditoriaOwnedByRun(byUserEntidad, registry), true);
    assert.equal(auditoriaOwnedByRun(byActor, registry), true);
    absorbOwnedAuditorias(registry, [byTicket, byUserEntidad, byActor]);
    assert.ok(registry.auditoriaIds.has("aud-t"));
    assert.ok(registry.auditoriaIds.has("aud-u"));
    assert.ok(registry.auditoriaIds.has("aud-a"));
  });

  it("7+8) credits virtual: getConfig snapshot y saveConfig sin escritura", async () => {
    // Simula ctx.credits = wrap(base, virtualControlOff)
    const base = createMemoryCreditosStore();
    await base.saveConfig({
      controlActivo: true,
      inicioEn: new Date("2020-01-01T00:00:00.000Z"),
      updatedByAdminId: "seed",
    });
    const virtualOff = buildVirtualCreditosConfig({
      controlActivo: false,
      inicioEn: null,
    });
    const credits = wrapStoreWithVirtualConfig(base, virtualOff);

    const cfg = await credits.getConfig();
    assert.equal(cfg.controlActivo, false);
    assert.equal(cfg.inicioEn, null);
    assert.equal(cfg.configPersisted, true);

    await assert.rejects(
      () =>
        credits.saveConfig({
          controlActivo: true,
          inicioEn: new Date(),
          updatedByAdminId: "admin",
        }),
      /prohibido persistir CreditosConfig/,
    );

    // El store base conserva su config; el wrapper no escribió encima.
    const raw = await base.getConfig();
    assert.equal(raw.controlActivo, true);
  });

  it("9) segunda limpieza no destructiva", async () => {
    const registry = emptyRegistry(RUN_A);
    registry.cleanupAllowed = true;
    let deleteCalls = 0;
    const first = await runCleanupPhases({
      registry,
      planBuilder: async () => ({
        movimientos: [],
        cuentas: [],
        ticketLineas: [],
        auditorias: [],
        sessions: [],
        tickets: [],
        users: ["u1"],
      }),
      deleteFn: async () => {
        deleteCalls += 1;
        return {
          deletedMovimientos: 0,
          deletedCuentas: 0,
          deletedTicketLineas: 0,
          deletedAuditorias: 0,
          deletedSessions: 0,
          deletedTickets: 0,
          deletedUsers: 1,
        };
      },
    });
    assert.equal(first.cleaned, true);
    assert.equal(deleteCalls, 1);
    assert.equal(registry.cleanupAllowed, false);

    const second = await runCleanupPhases({
      registry,
      planBuilder: async () => {
        throw new Error("no debe planificar");
      },
      deleteFn: async () => {
        deleteCalls += 1;
        throw new Error("no debe borrar");
      },
    });
    assert.deepEqual(second, emptyCleanupReport());
    assert.equal(deleteCalls, 1);
  });

  it("10) error de lectura durante planificación: no se ejecutan borrados", async () => {
    const registry = emptyRegistry(RUN_A);
    registry.cleanupAllowed = true;
    let deleteCalls = 0;
    await assert.rejects(
      () =>
        runCleanupPhases({
          registry,
          planBuilder: async () => {
            throw new Error("lectura fallida: connection reset");
          },
          deleteFn: async () => {
            deleteCalls += 1;
            return {
              deletedMovimientos: 0,
              deletedCuentas: 0,
              deletedTicketLineas: 0,
              deletedAuditorias: 0,
              deletedSessions: 0,
              deletedTickets: 0,
              deletedUsers: 0,
            };
          },
        }),
      /lectura fallida/,
    );
    assert.equal(deleteCalls, 0);
    assert.equal(registry.cleanupAllowed, true);
  });
});
