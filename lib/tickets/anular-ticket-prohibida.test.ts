/**
 * C7.2 — anulación de tickets prohibida de forma absoluta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canAccessAdminApi } from "@/lib/acceptance/authorize-rules";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import {
  TicketAnulacionProhibidaError,
} from "@/lib/tickets/errors";
import { mapTicketErrorToHttp } from "@/lib/tickets/map-ticket-http-error";

const ROOT = path.resolve(__dirname, "../..");

describe("C7.2 — anulación de tickets prohibida", () => {
  it("servicio anularTicket siempre lanza y no toca DB", async () => {
    let touched = false;
    const db = {
      ticket: {
        updateMany: async () => {
          touched = true;
          return { count: 1 };
        },
        findUnique: async () => {
          touched = true;
          return null;
        },
      },
      auditoria: {
        create: async () => {
          touched = true;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        touched = true;
        return fn(db);
      },
    };

    await assert.rejects(
      () =>
        anularTicket(db as never, {
          id: "t1",
          motivo: "intento",
          anuladoPorId: "admin1",
        }),
      (err: unknown) => {
        assert.ok(err instanceof TicketAnulacionProhibidaError);
        assert.equal(err.code, "TICKET_ANULACION_PROHIBIDA");
        return true;
      },
    );
    assert.equal(touched, false);
  });

  it("HTTP mapea a 403 TICKET_ANULACION_PROHIBIDA", () => {
    const mapped = mapTicketErrorToHttp(new TicketAnulacionProhibidaError());
    assert.equal(mapped.status, 403);
    assert.equal(mapped.body.error.code, "TICKET_ANULACION_PROHIBIDA");
  });

  it("API anular rechaza sin llamar anularTicket productivo", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/api/admin/tickets/[id]/anular/route.ts"),
      "utf8",
    );
    assert.match(src, /TicketAnulacionProhibidaError/);
    assert.match(src, /requireAdmin/);
    assert.doesNotMatch(src, /await anularTicket/);
  });

  it("VENDEDOR no tiene acceso admin API; ADMIN tampoco puede anular vía servicio", async () => {
    assert.equal(
      canAccessAdminApi({
        id: "v",
        nombre: "V",
        usuario: "v",
        rol: "VENDEDOR",
        activo: true,
      }),
      false,
    );
    await assert.rejects(
      () =>
        anularTicket({} as never, {
          id: "x",
          motivo: "x",
          anuladoPorId: "v",
        }),
      TicketAnulacionProhibidaError,
    );
    await assert.rejects(
      () =>
        anularTicket({} as never, {
          id: "x",
          motivo: "x",
          anuladoPorId: "admin",
        }),
      TicketAnulacionProhibidaError,
    );
  });

  it("UI admin detalle no monta acción de anulación operativa", () => {
    const page = fs.readFileSync(
      path.join(ROOT, "app/admin/tickets/[id]/page.tsx"),
      "utf8",
    );
    assert.doesNotMatch(page, /AnularTicketPanel/);
    assert.match(page, /Anulación no disponible/);
    const panel = fs.readFileSync(
      path.join(ROOT, "components/tickets/AnularTicketPanel.tsx"),
      "utf8",
    );
    assert.doesNotMatch(panel, /\/anular/);
    assert.doesNotMatch(panel, /fetch\(/);
  });

  it("servicio no importa ni llama devolución de créditos", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/tickets/anular-ticket.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /devolverCreditosPorAnulacion/);
    assert.doesNotMatch(src, /updateMany/);
    assert.doesNotMatch(src, /cajaObligacion|CajaAplicacion/);
    assert.match(src, /TicketAnulacionProhibidaError/);
  });
});
