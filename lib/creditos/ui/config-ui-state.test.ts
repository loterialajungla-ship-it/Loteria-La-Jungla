import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDITOS_CONFIG_UI_COPY,
  resolveCreditosConfigUiState,
} from "@/lib/creditos/ui/config-ui-state";
import type { CreditosConfigPublic } from "@/lib/creditos/ui/api-types";

function cfg(
  partial: Partial<CreditosConfigPublic> &
    Pick<CreditosConfigPublic, "configPersisted" | "controlActivo">,
): CreditosConfigPublic {
  return {
    inicioEn: null,
    umbralSaldoBajo: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
    updatedByAdminId: null,
    ...partial,
  };
}

describe("resolveCreditosConfigUiState", () => {
  it("estado ausente", () => {
    assert.equal(
      resolveCreditosConfigUiState(
        cfg({ configPersisted: false, controlActivo: false }),
        false,
      ),
      "ausente",
    );
    assert.match(
      CREDITOS_CONFIG_UI_COPY.ausente.title,
      /no inicializada/i,
    );
  });

  it("estado persistido apagado", () => {
    assert.equal(
      resolveCreditosConfigUiState(
        cfg({ configPersisted: true, controlActivo: false }),
        false,
      ),
      "persistida_apagada",
    );
    assert.match(
      CREDITOS_CONFIG_UI_COPY.persistida_apagada.title,
      /desactivado/i,
    );
  });

  it("estado activo", () => {
    assert.equal(
      resolveCreditosConfigUiState(
        cfg({
          configPersisted: true,
          controlActivo: true,
          inicioEn: "2026-11-01T04:00:00.000Z",
        }),
        false,
      ),
      "persistida_activa",
    );
  });

  it("error temporal (sin inventar defaults)", () => {
    assert.equal(resolveCreditosConfigUiState(null, true), "error");
    assert.equal(resolveCreditosConfigUiState(undefined, true), "error");
    assert.equal(
      resolveCreditosConfigUiState(
        cfg({ configPersisted: true, controlActivo: false }),
        true,
      ),
      "error",
    );
    assert.match(
      CREDITOS_CONFIG_UI_COPY.error.title,
      /No se pudo consultar la configuración/i,
    );
  });

  it("ausente ≠ apagado aunque controlActivo sea false en defaults virtuales", () => {
    const a = resolveCreditosConfigUiState(
      cfg({ configPersisted: false, controlActivo: false }),
      false,
    );
    const b = resolveCreditosConfigUiState(
      cfg({ configPersisted: true, controlActivo: false }),
      false,
    );
    assert.equal(a, "ausente");
    assert.equal(b, "persistida_apagada");
    assert.notEqual(a, b);
  });
});
