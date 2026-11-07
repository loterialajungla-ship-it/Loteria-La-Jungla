/**
 * C7.2: anularTicket no ejecuta devolución de créditos.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anularTicket } from "@/lib/tickets/anular-ticket";
import { TicketAnulacionProhibidaError } from "@/lib/tickets/errors";

describe("anularTicket + créditos (C7.2 prohibición)", () => {
  it("rechaza anulación sin invocar bindCreditsStore", async () => {
    let bindCalls = 0;
    await assert.rejects(
      () =>
        anularTicket(
          {
            ticket: {},
            auditoria: {},
            $transaction: async () => {
              throw new Error("no debe entrar en TX");
            },
          } as never,
          {
            id: "t-cred",
            motivo: "no permitido",
            anuladoPorId: "admin-1",
          },
          {
            bindCreditsStore: () => {
              bindCalls += 1;
              return {} as never;
            },
          },
        ),
      TicketAnulacionProhibidaError,
    );
    assert.equal(bindCalls, 0);
  });

  it("rechaza también sin actor admin", async () => {
    await assert.rejects(
      () =>
        anularTicket({} as never, {
          id: "t2",
          motivo: "x",
        }),
      TicketAnulacionProhibidaError,
    );
  });
});
