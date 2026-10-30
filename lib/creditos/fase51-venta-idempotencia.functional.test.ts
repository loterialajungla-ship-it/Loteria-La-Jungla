/**
 * Fase 5.1 — idempotencia de venta × consumo de créditos en TEST.
 *
 * - NO muta CreditosConfig (usa el estado actual de TEST).
 * - Crea vendedor/admin aislados (prefijo fase51_idem_).
 * - Limpia solo movimientos/cuentas/tickets/sesiones de esta corrida.
 * - No borra Auditoria ni usuarios residuales de Fase 5.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  ANIMAL_A,
  ANIMAL_B,
  assertSaldoCoincideLibro,
  bootstrapFase5,
  type Fase5Context,
} from "@/lib/creditos/fase5/harness";
import { asignarCreditos, consultarSaldoYHistorial } from "@/lib/creditos/operaciones";
import { IdempotencyConflictError } from "@/lib/tickets/errors";
import { createTicket } from "@/lib/tickets/create-ticket";
import {
  AHORA_VE_MANANA,
  newIdempotencyKey,
} from "@/lib/tickets/integration/harness";
import { hoyYYYYMMDD } from "@/lib/fecha";

const ENABLED = process.env.RUN_INTEGRATION === "1";

describe(
  "Fase 5.1 — idempotencia venta + créditos (TEST)",
  { skip: !ENABLED },
  () => {
    let ctx: Fase5Context;
    let admin: { id: string };
    let vend: { id: string };
    let configAtStart: {
      controlActivo: boolean;
      hasInicioEn: boolean;
    };
    let evidence: Record<string, unknown> = {};

    before(async () => {
      ctx = await bootstrapFase5();
      // Snapshot solo lectura — no se restaura mutando (no tocamos config).
      const snap = await ctx.snapshotConfig();
      configAtStart = {
        controlActivo: snap.controlActivo,
        hasInicioEn: snap.inicioEn != null,
      };
      if (!snap.controlActivo || !snap.inicioEn) {
        throw new Error(
          "BLOCKED: CreditosConfig en TEST no tiene control activo+inicioEn; " +
            "Fase 5.1 no está autorizada a activarlo.",
        );
      }
      if (snap.inicioEn.getTime() > Date.now()) {
        throw new Error(
          "BLOCKED: inicioEn es futuro; consumo no aplicaría y no podemos " +
            "cambiar la config en esta fase.",
        );
      }
      // Override prefix users via createUser suffix — harness uses fase5_qa_
      // We use distinct suffix for isolation labeling.
      admin = await ctx.createUser({
        suffix: "idem_adm",
        nombre: "F51 Idem Admin",
        rol: "ADMIN",
      });
      vend = await ctx.createUser({
        suffix: "idem_v",
        nombre: "F51 Idem Vend",
        rol: "VENDEDOR",
      });
    });

    after(async () => {
      try {
        console.log(
          JSON.stringify({
            fase51: "venta-idempotencia",
            configUnchangedPolicy: "no mutamos CreditosConfig",
            configAtStart,
            evidence,
          }),
        );
        // Limpieza acotada: movs/cuentas/tickets/sesiones de userIds de esta corrida.
        // restoreConfig se llama en cleanupOwn — lo evitamos anulando snapshot
        // para no reescribir config (ya es la misma).
        if (ctx) {
          ctx.registry.configSnapshot = null;
          const cleanup = await ctx.cleanupOwn();
          console.log(JSON.stringify({ cleanup }));
          await ctx.db.$disconnect();
        }
      } catch (e) {
        console.error(e);
        try {
          await ctx?.db.$disconnect();
        } catch {
          /* ignore */
        }
      }
    });

    it("replay misma clave: un ticket, un consumo; mismatch → conflicto", async () => {
      await asignarCreditos(ctx.credits, {
        vendedorId: vend.id,
        importe: "50.00",
        actorAdminId: admin.id,
        motivo: "fase51 idem seed",
        idempotencyKey: newIdempotencyKey(),
      });

      const key = newIdempotencyKey();
      const payload = {
        fechaJuego: hoyYYYYMMDD(AHORA_VE_MANANA),
        vendedorId: vend.id,
        idempotencyKey: key,
        lineas: [
          { hora: 14, numeroAnimal: ANIMAL_A, importe: "4.00" },
          { hora: 15, numeroAnimal: ANIMAL_B, importe: "6.00" },
        ],
      };

      const first = await createTicket(payload, AHORA_VE_MANANA, ctx.db, {
        actorRol: "VENDEDOR",
      });
      ctx.trackTicket(first.ticket.id);
      assert.equal(first.idempotentReplay, false);
      assert.equal(first.ticket.totalApostado, "10.00");

      const replay = await createTicket(payload, AHORA_VE_MANANA, ctx.db, {
        actorRol: "VENDEDOR",
      });
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.ticket.id, first.ticket.id);

      const tickets = await ctx.db.ticket.findMany({
        where: { idempotencyKey: key },
      });
      assert.equal(tickets.length, 1);

      let hist = await consultarSaldoYHistorial(ctx.credits, vend.id);
      const consumos = hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA");
      assert.equal(consumos.length, 1);
      assert.equal(consumos[0]!.importe.toFixed(2), "10.00");
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "40.00");
      await assertSaldoCoincideLibro(
        hist.cuenta!.saldoDisponible,
        hist.movimientos,
      );

      await assert.rejects(
        () =>
          createTicket(
            {
              ...payload,
              lineas: [
                { hora: 14, numeroAnimal: ANIMAL_A, importe: "9.00" },
              ],
            },
            AHORA_VE_MANANA,
            ctx.db,
            { actorRol: "VENDEDOR" },
          ),
        (e: unknown) =>
          e instanceof IdempotencyConflictError &&
          (e as IdempotencyConflictError).code === "IDEMPOTENCY_PAYLOAD_MISMATCH",
      );

      // Tras conflicto: sigue un solo ticket y un solo consumo
      assert.equal(
        await ctx.db.ticket.count({ where: { idempotencyKey: key } }),
        1,
      );
      hist = await consultarSaldoYHistorial(ctx.credits, vend.id);
      assert.equal(
        hist.movimientos.filter((m) => m.tipo === "CONSUMO_VENTA").length,
        1,
      );
      assert.equal(hist.cuenta?.saldoDisponible.toFixed(2), "40.00");
      await assertSaldoCoincideLibro(
        hist.cuenta!.saldoDisponible,
        hist.movimientos,
      );

      evidence = {
        result: "PASS",
        ticketsConMismaClave: 1,
        consumos: 1,
        saldoTrasReplayYConflicto: "40.00",
        ticketId: first.ticket.id,
        consumoImporte: "10.00",
        asignacionInicial: "50.00",
        libroConciliado: true,
      };
    });
  },
);
