import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMiCuentaSaldoFailure,
  applyMiCuentaSaldoIgnored,
  applyMiCuentaSaldoSuccess,
  beginMiCuentaSaldoRequest,
  initialMiCuentaSaldoState,
  isMiCuentaCreditosResponse,
  MI_CUENTA_SALDO_QUERY,
  parseMiCuentaSaldoPayload,
  resolvePosSaldoViewModel,
  type MiCuentaSaldoData,
} from "@/lib/creditos/ui/mi-cuenta-saldo-model";

function sampleData(
  partial?: Partial<{
    configPersisted: boolean;
    controlActivo: boolean;
    tieneCuenta: boolean;
    saldoDisponible: string;
    saldoBajo: boolean;
  }>,
): MiCuentaSaldoData {
  return {
    activo: true,
    config: {
      configPersisted: partial?.configPersisted ?? true,
      controlActivo: partial?.controlActivo ?? true,
      inicioEn: "2026-11-01T04:00:00.000Z",
    },
    cuenta: {
      saldoDisponible: partial?.saldoDisponible ?? "25.00",
      tieneCuenta: partial?.tieneCuenta ?? true,
      saldoBajo: partial?.saldoBajo ?? false,
      umbralSaldoBajo: "10.00",
    },
  };
}

describe("mi-cuenta-saldo-model — query", () => {
  it("usa page=1&pageSize=1 para minimizar historial", () => {
    assert.equal(MI_CUENTA_SALDO_QUERY, "page=1&pageSize=1");
  });
});

describe("mi-cuenta-saldo-model — parse", () => {
  it("acepta respuesta ok con config mínima", () => {
    const json = {
      ok: true,
      activo: true,
      config: {
        configPersisted: true,
        controlActivo: false,
        inicioEn: null,
      },
      cuenta: {
        saldoDisponible: "0.00",
        tieneCuenta: false,
        saldoBajo: false,
        umbralSaldoBajo: null,
      },
      movimientos: [],
      page: 1,
      pageSize: 1,
      total: 0,
      totalPages: 0,
    };
    const parsed = parseMiCuentaSaldoPayload(json);
    assert.ok(parsed);
    assert.equal(parsed.config.controlActivo, false);
    assert.equal(parsed.cuenta.tieneCuenta, false);
    assert.equal(isMiCuentaCreditosResponse(json), true);
  });

  it("rechaza payload sin config (contrato antiguo incompleto)", () => {
    assert.equal(
      parseMiCuentaSaldoPayload({
        ok: true,
        activo: true,
        cuenta: {
          saldoDisponible: "1.00",
          tieneCuenta: true,
          saldoBajo: false,
          umbralSaldoBajo: null,
        },
      }),
      null,
    );
  });
});

describe("mi-cuenta-saldo-model — carreras y errores", () => {
  it("1. carga inicial sin datos → loading + busy", () => {
    const s0 = initialMiCuentaSaldoState();
    assert.equal(s0.loading, true);
    const view0 = resolvePosSaldoViewModel(s0);
    assert.equal(view0.kind, "loading");
    assert.equal(view0.busy, true);
    const s1 = beginMiCuentaSaldoRequest(s0, 1);
    assert.equal(s1.loading, true);
    assert.equal(s1.data, null);
    assert.equal(s1.latestRequestId, 1);
    const view = resolvePosSaldoViewModel(s1);
    assert.equal(view.kind, "loading");
    assert.equal(view.busy, true);
    assert.equal(view.updating, false);
    assert.match(view.primary, /Consultando saldo/);
  });

  it("2. refresco con datos previos → saldo visible + updating", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData({ saldoDisponible: "42.50" }),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    assert.equal(state.loading, true);
    assert.equal(state.data?.cuenta.saldoDisponible, "42.50");
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /42\.50/);
    assert.equal(view.busy, true);
    assert.equal(view.updating, true);
    assert.equal(view.stale, false);
  });

  it("refresco tras stale: oculta stale/error y solo muestra Actualizando", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData({ saldoDisponible: "42.50" }),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoFailure(state, 2, {
      status: 0,
      message: "Error de red al consultar el saldo.",
    });
    assert.equal(state.stale, true);
    state = beginMiCuentaSaldoRequest(state, 3);
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /42\.50/);
    assert.equal(view.updating, true);
    assert.equal(view.busy, true);
    assert.equal(view.stale, false);
    assert.equal(view.error, null);
    assert.equal(view.canRetry, false);
  });

  it("3. refresco exitoso → saldo nuevo y sin indicador", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData({ saldoDisponible: "42.50" }),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoSuccess(
      state,
      2,
      sampleData({ saldoDisponible: "3.25", saldoBajo: true }),
    );
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /3\.25/);
    assert.equal(view.showSaldoBajo, true);
    assert.equal(view.busy, false);
    assert.equal(view.updating, false);
    assert.equal(view.stale, false);
    assert.equal(view.error, null);
  });

  it("4. refresco fallido con data previa → stale visible", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData({ saldoDisponible: "42.50" }),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoFailure(state, 2, {
      status: 0,
      message: "Error de red al consultar el saldo.",
    });
    assert.equal(state.stale, true);
    assert.equal(state.data?.cuenta.saldoDisponible, "42.50");
    assert.match(state.error ?? "", /red/i);
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /42\.50/);
    assert.equal(view.stale, true);
    assert.equal(view.canRetry, true);
    assert.equal(view.busy, false);
    assert.equal(view.updating, false);
  });

  it("5. error inicial sin datos → error + reintento", () => {
    let state = beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1);
    state = applyMiCuentaSaldoFailure(state, 1, {
      status: 503,
      message: "No se pudo consultar el saldo. Inténtalo de nuevo.",
    });
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "error");
    assert.equal(view.canRetry, true);
    assert.equal(view.busy, false);
    assert.equal(view.updating, false);
    assert.ok(view.error);
  });

  it("6. respuesta fuera de orden no sobrescribe la reciente", () => {
    let state = beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1);
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoSuccess(state, 1, sampleData({ saldoDisponible: "1.00" }));
    assert.equal(state.data, null);
    assert.equal(state.loading, true);
    state = applyMiCuentaSaldoSuccess(
      state,
      2,
      sampleData({ saldoDisponible: "99.00" }),
    );
    assert.equal(state.data?.cuenta.saldoDisponible, "99.00");
    assert.equal(state.loading, false);
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.updating, false);
    assert.match(view.primary, /99\.00/);
  });

  it("7. cancelación/ignorado no marca stale ni borra data", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData(),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoIgnored(state, 2);
    assert.equal(state.loading, false);
    assert.equal(state.stale, false);
    assert.ok(state.data);
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.busy, false);
    assert.equal(view.updating, false);
  });

  it("8. 401 limpia los datos de sesión", () => {
    let state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sampleData(),
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoFailure(state, 2, {
      status: 401,
      message: "Sesión expirada. Vuelve a iniciar sesión.",
    });
    assert.equal(state.data, null);
    assert.equal(state.stale, false);
    assert.match(state.error ?? "", /sesión/i);
    const view = resolvePosSaldoViewModel(state);
    assert.equal(view.kind, "error");
    assert.equal(view.canRetry, true);
  });

  it("reintento: begin + success limpia error/stale", () => {
    let state = applyMiCuentaSaldoFailure(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      { status: 500, message: "fallo" },
    );
    state = beginMiCuentaSaldoRequest(state, 2);
    state = applyMiCuentaSaldoSuccess(state, 2, sampleData());
    assert.equal(state.error, null);
    assert.equal(state.stale, false);
  });
});

describe("mi-cuenta-saldo-model — view model badge", () => {
  it("control activo con saldo", () => {
    const view = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({ controlActivo: true, saldoDisponible: "12.50" }),
    });
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /Tu saldo:\s*12\.50/);
    assert.equal(view.showSaldoBajo, false);
  });

  it("control inactivo", () => {
    const view = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({ controlActivo: false }),
    });
    assert.equal(view.kind, "control_inactivo");
    assert.match(view.primary, /inactivo/i);
    assert.match(view.secondary ?? "", /informativo/i);
  });

  it("configuración no inicializada", () => {
    const view = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({ configPersisted: false, controlActivo: false }),
    });
    assert.equal(view.kind, "config_ausente");
    assert.match(view.primary, /no configurado/i);
  });

  it("sin cuenta no finge saldo cero de cuenta", () => {
    const view = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({
        tieneCuenta: false,
        saldoDisponible: "0.00",
        controlActivo: true,
      }),
    });
    assert.equal(view.kind, "sin_cuenta");
    assert.match(view.primary, /Sin cuenta/i);
    assert.notEqual(view.primary.startsWith("Tu saldo:"), true);
  });

  it("saldo cero con cuenta", () => {
    const view = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({
        tieneCuenta: true,
        saldoDisponible: "0.00",
        controlActivo: true,
      }),
    });
    assert.equal(view.kind, "saldo");
    assert.match(view.primary, /0\.00/);
  });

  it("saldo bajo solo si el servidor lo marca", () => {
    const bajo = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({ saldoBajo: true }),
    });
    assert.equal(bajo.showSaldoBajo, true);
    const ok = resolvePosSaldoViewModel({
      ...initialMiCuentaSaldoState(),
      data: sampleData({ saldoBajo: false }),
    });
    assert.equal(ok.showSaldoBajo, false);
  });
});
