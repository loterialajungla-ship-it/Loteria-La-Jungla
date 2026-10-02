import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apuestasALineasApi,
  contarLineas,
  eliminarLinea,
  puedeCrearTicket,
  toggleHora,
  totalOrientativo,
  upsertLinea,
} from "@/components/tickets/pos-state";

describe("pos-state", () => {
  it("permite seleccionar varias horas", () => {
    let s = {};
    s = toggleHora(s, 10);
    s = toggleHora(s, 12);
    assert.deepEqual(Object.keys(s).sort(), ["10", "12"]);
  });

  it("añade línea y no duplica misma hora+animal (actualiza importe)", () => {
    let s = toggleHora({}, 10);
    s = upsertLinea(s, 10, "03", "2.00");
    s = upsertLinea(s, 10, "03", "5.00");
    assert.equal(s["10"]["03"], "5.00");
    assert.equal(contarLineas(s), 1);
  });

  it("elimina una línea", () => {
    let s = upsertLinea(toggleHora({}, 10), 10, "03", "2.00");
    s = eliminarLinea(s, 10, "03");
    assert.equal(contarLineas(s), 0);
  });

  it("actualiza el total orientativo", () => {
    let s = toggleHora({}, 10);
    s = upsertLinea(s, 10, "03", "2.00");
    s = upsertLinea(s, 10, "15", "5.50");
    assert.equal(totalOrientativo(s), "7.50");
  });

  it("puedeCrearTicket requiere al menos una línea con importe", () => {
    assert.equal(puedeCrearTicket({}), false);
    assert.equal(puedeCrearTicket({ "10": {} }), false);
    assert.equal(
      puedeCrearTicket(upsertLinea(toggleHora({}, 10), 10, "03", "1.00")),
      true,
    );
  });

  it("serializa al formato de API", () => {
    let s = toggleHora({}, 10);
    s = upsertLinea(s, 10, "03", "2.00");
    s = toggleHora(s, 12);
    s = upsertLinea(s, 12, "03", "3.00");
    assert.deepEqual(apuestasALineasApi(s), [
      { hora: 10, numeroAnimal: "03", importe: "2.00" },
      { hora: 12, numeroAnimal: "03", importe: "3.00" },
    ]);
  });
});
