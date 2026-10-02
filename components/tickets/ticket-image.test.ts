import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TicketPreviewData } from "@/components/tickets/TicketPreview";
import {
  buildTicketConsultaUrl,
  horasEnTicket,
  isUsablePngDataUrl,
  resolveTicketExportSize,
  sanitizeTicketForClientImage,
  scaleQrFrameToCanvas,
  ticketPngFileName,
} from "@/components/tickets/ticket-image";

const ticketBase: TicketPreviewData = {
  numeroVisible: "LJ-20261001-000001",
  codigoPublico: "abcXYZSecureCode",
  fechaJuego: "2026-10-01",
  totalApostado: "13.00",
  lineas: [
    {
      hora: 10,
      numeroAnimal: "03",
      nombreAnimalSnapshot: "Ciempiés",
      importe: "2.00",
    },
    {
      hora: 12,
      numeroAnimal: "03",
      nombreAnimalSnapshot: "Ciempiés",
      importe: "3.00",
    },
    {
      hora: 10,
      numeroAnimal: "15",
      nombreAnimalSnapshot: "Zorro",
      importe: "5.00",
    },
  ],
};

describe("ticket-image helpers", () => {
  it("genera nombre de archivo ticket-LJ-….png", () => {
    assert.equal(
      ticketPngFileName("LJ-20261001-000001"),
      "ticket-LJ-20261001-000001.png",
    );
  });

  it("construye URL QR con codigoPublico", () => {
    assert.equal(
      buildTicketConsultaUrl("https://ejemplo.com", "abcXYZSecureCode"),
      "https://ejemplo.com/ticket/abcXYZSecureCode",
    );
  });

  it("incluye total jugado y varias horas; sin multiplicador ni premio", () => {
    const clean = sanitizeTicketForClientImage({ ...ticketBase });
    assert.equal(clean.totalApostado, "13.00");
    assert.deepEqual(horasEnTicket(clean), [10, 12]);
    assert.ok(!("multiplicadorUsado" in clean));
    assert.ok(!("premio" in clean));
    assert.ok(!("premioTotal" in clean));
  });

  it("rechaza payload con multiplicador o premio", () => {
    assert.throws(() =>
      sanitizeTicketForClientImage({
        ...ticketBase,
        multiplicadorUsado: 30,
      } as TicketPreviewData & Record<string, unknown>),
    );
    assert.throws(() =>
      sanitizeTicketForClientImage({
        ...ticketBase,
        premio: "100",
      } as TicketPreviewData & Record<string, unknown>),
    );
  });

  it("resolveTicketExportSize usa el máximo de métricas (evita recorte)", () => {
    const size = resolveTicketExportSize({
      scrollWidth: 360,
      offsetWidth: 352,
      clientWidth: 350,
      scrollHeight: 800,
      offsetHeight: 790,
      clientHeight: 788,
    });
    assert.equal(size.width, 360);
    assert.equal(size.height, 800);
  });

  it("isUsablePngDataUrl rechaza vacío y acepta PNG base64 razonable", () => {
    assert.equal(isUsablePngDataUrl(""), false);
    assert.equal(isUsablePngDataUrl("data:,"), false);
    assert.equal(isUsablePngDataUrl("data:image/png;base64,abc"), false);
    assert.equal(
      isUsablePngDataUrl(`data:image/png;base64,${"A".repeat(300)}`),
      true,
    );
  });

  it("scaleQrFrameToCanvas escala con pixelRatio implícito del canvas", () => {
    const scaled = scaleQrFrameToCanvas(
      { x: 10, y: 20, width: 100, height: 100 },
      352,
      704,
    );
    assert.equal(scaled.x, 20);
    assert.equal(scaled.y, 40);
    assert.equal(scaled.width, 200);
    assert.equal(scaled.height, 200);
  });
});
