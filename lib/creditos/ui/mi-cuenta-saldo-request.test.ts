import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMiCuentaSaldoSuccess,
  beginMiCuentaSaldoRequest,
  initialMiCuentaSaldoState,
  type MiCuentaSaldoData,
} from "@/lib/creditos/ui/mi-cuenta-saldo-model";
import {
  acceptMiCuentaSaldoResult,
  executeMiCuentaSaldoRequest,
  runMiCuentaSaldoRefresh,
} from "@/lib/creditos/ui/mi-cuenta-saldo-request";

function okBody(data: MiCuentaSaldoData): unknown {
  return {
    ok: true,
    activo: data.activo,
    config: data.config,
    cuenta: data.cuenta,
    movimientos: [],
    page: 1,
    pageSize: 1,
    total: 0,
    totalPages: 0,
  };
}

function sample(saldo = "10.00"): MiCuentaSaldoData {
  return {
    activo: true,
    config: {
      configPersisted: true,
      controlActivo: true,
      inicioEn: null,
    },
    cuenta: {
      saldoDisponible: saldo,
      tieneCuenta: true,
      saldoBajo: false,
      umbralSaldoBajo: null,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mi-cuenta-saldo-request (hook orchestration)", () => {
  it("carga inicial exitosa", async () => {
    const data = sample("42.00");
    const result = await runMiCuentaSaldoRefresh({
      state: initialMiCuentaSaldoState(),
      requestId: 1,
      signal: new AbortController().signal,
      fetchImpl: async () => jsonResponse(200, okBody(data)),
    });
    assert.equal(result.ignored, false);
    assert.equal(result.state.loading, false);
    assert.equal(result.state.data?.cuenta.saldoDisponible, "42.00");
  });

  it("cancela con AbortSignal y no marca stale", async () => {
    const ac = new AbortController();
    const state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sample("5.00"),
    );
    const pending = runMiCuentaSaldoRefresh({
      state,
      requestId: 2,
      signal: ac.signal,
      fetchImpl: async (_url, init) => {
        ac.abort();
        const signal = init?.signal;
        if (signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return jsonResponse(200, okBody(sample("999.00")));
      },
    });
    const result = await pending;
    assert.equal(result.ignored, true);
    // Tras abort ignored, loading false; data del started begin no incluye prev —
    // begin conserva data previa:
    assert.equal(result.state.data?.cuenta.saldoDisponible, "5.00");
    assert.equal(result.state.stale, false);
  });

  it("respuesta fuera de orden (requestId viejo) se ignora", async () => {
    const state = beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 2);
    const ignored = applyMiCuentaSaldoSuccess(state, 1, sample("1.00"));
    assert.equal(ignored.data, null);
    assert.equal(ignored.latestRequestId, 2);
    const applied = applyMiCuentaSaldoSuccess(state, 2, sample("2.00"));
    assert.equal(applied.data?.cuenta.saldoDisponible, "2.00");
  });

  it("error de red con saldo previo → stale", async () => {
    const state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sample("7.00"),
    );
    const result = await runMiCuentaSaldoRefresh({
      state,
      requestId: 2,
      signal: new AbortController().signal,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(result.state.stale, true);
    assert.equal(result.state.data?.cuenta.saldoDisponible, "7.00");
    assert.match(result.state.error ?? "", /red/i);
  });

  it("401 limpia estado", async () => {
    const state = applyMiCuentaSaldoSuccess(
      beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
      1,
      sample("7.00"),
    );
    const result = await runMiCuentaSaldoRefresh({
      state,
      requestId: 2,
      signal: new AbortController().signal,
      fetchImpl: async () =>
        jsonResponse(401, {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "No auth" },
        }),
    });
    assert.equal(result.state.data, null);
    assert.equal(result.state.stale, false);
    assert.match(result.state.error ?? "", /sesión/i);
  });

  it("N termina después de N+1: accept descarta N aunque execute devolviera data", async () => {
    /**
     * Simula el commit del hook: AbortController no impidió que N acabara;
     * latestRequestId ya es N+1 → el saldo de N no debe aplicarse.
     */
    let latestRequestId = 0;
    let visible = initialMiCuentaSaldoState();

    async function refreshLikeHook(
      fetchImpl: (
        input: string,
        init?: RequestInit,
      ) => Promise<Response>,
    ) {
      latestRequestId += 1;
      const requestId = latestRequestId;
      const started = beginMiCuentaSaldoRequest(visible, requestId);
      visible = started;
      const result = await executeMiCuentaSaldoRequest({
        state: started,
        requestId,
        signal: new AbortController().signal,
        fetchImpl,
      });
      const accepted = acceptMiCuentaSaldoResult({
        requestId,
        latestRequestId,
        result,
      });
      if (accepted) visible = accepted;
    }

    let resolveN: (r: Response) => void;
    const nResponse = new Promise<Response>((resolve) => {
      resolveN = resolve;
    });

    const pN = refreshLikeHook(async () => nResponse);
    const pN1 = refreshLikeHook(async () =>
      jsonResponse(200, okBody(sample("99.00"))),
    );

    await pN1;
    assert.equal(visible.data?.cuenta.saldoDisponible, "99.00");
    assert.equal(latestRequestId, 2);

    resolveN!(jsonResponse(200, okBody(sample("1.00"))));
    await pN;

    assert.equal(visible.data?.cuenta.saldoDisponible, "99.00");
    assert.notEqual(visible.data?.cuenta.saldoDisponible, "1.00");
  });

  it("acceptMiCuentaSaldoResult rechaza requestId obsoleto", () => {
    const result = {
      ignored: false,
      state: applyMiCuentaSaldoSuccess(
        beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 1),
        1,
        sample("5.00"),
      ),
    };
    assert.equal(
      acceptMiCuentaSaldoResult({
        requestId: 1,
        latestRequestId: 2,
        result,
      }),
      null,
    );
    const ok = acceptMiCuentaSaldoResult({
      requestId: 2,
      latestRequestId: 2,
      result: {
        ignored: false,
        state: applyMiCuentaSaldoSuccess(
          beginMiCuentaSaldoRequest(initialMiCuentaSaldoState(), 2),
          2,
          sample("8.00"),
        ),
      },
    });
    assert.equal(ok?.data?.cuenta.saldoDisponible, "8.00");
  });

  it("reintento tras error recupera saldo", async () => {
    const state = initialMiCuentaSaldoState();
    const fail = await runMiCuentaSaldoRefresh({
      state,
      requestId: 1,
      signal: new AbortController().signal,
      fetchImpl: async () => jsonResponse(500, { ok: false }),
    });
    assert.ok(fail.state.error);
    const ok = await runMiCuentaSaldoRefresh({
      state: fail.state,
      requestId: 2,
      signal: new AbortController().signal,
      fetchImpl: async () => jsonResponse(200, okBody(sample("3.50"))),
    });
    assert.equal(ok.state.error, null);
    assert.equal(ok.state.data?.cuenta.saldoDisponible, "3.50");
  });
});
