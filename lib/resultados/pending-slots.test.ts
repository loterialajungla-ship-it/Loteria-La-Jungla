import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { listDueDrawSlots } from "@/lib/resultados/pending-slots";

describe("listDueDrawSlots (America/Caracas)", () => {
  it("antes de las 09:00 VE no hay franjas vencidas", () => {
    // 2026-10-02 12:00 UTC = 08:00 America/Caracas
    const slots = listDueDrawSlots(new Date(Date.UTC(2026, 9, 2, 12, 0, 0)));
    assert.deepEqual(slots, []);
  });

  it("a las 10:00 VE incluye 09 y 10, no futuras", () => {
    // 2026-10-02 14:00 UTC = 10:00 America/Caracas
    const slots = listDueDrawSlots(new Date(Date.UTC(2026, 9, 2, 14, 0, 0)));
    assert.equal(slots.length, 2);
    assert.equal(fechaAYYYYMMDD(slots[0]!.fecha), "2026-10-02");
    assert.deepEqual(
      slots.map((s) => s.hora),
      [9, 10],
    );
  });

  it("a las 19:00 VE incluye las 11 franjas del día", () => {
    // 2026-10-02 23:00 UTC = 19:00 America/Caracas
    const slots = listDueDrawSlots(new Date(Date.UTC(2026, 9, 2, 23, 0, 0)));
    assert.deepEqual(
      slots.map((s) => s.hora),
      [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
  });

  it("cambio de fecha calendario en Caracas", () => {
    // 2026-10-03 04:00 UTC = 2026-10-03 00:00 America/Caracas
    const slots = listDueDrawSlots(new Date(Date.UTC(2026, 9, 3, 4, 0, 0)));
    assert.equal(slots.length, 0);
    // 2026-10-03 13:30 UTC = 09:30 America/Caracas
    const slots2 = listDueDrawSlots(new Date(Date.UTC(2026, 9, 3, 13, 30, 0)));
    assert.equal(fechaAYYYYMMDD(slots2[0]!.fecha), "2026-10-03");
    assert.deepEqual(
      slots2.map((s) => s.hora),
      [9],
    );
  });
});
