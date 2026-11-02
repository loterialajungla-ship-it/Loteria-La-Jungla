/**
 * Orquestación de fetch para saldo POS (testeable sin React).
 */
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import {
  applyMiCuentaSaldoFailure,
  applyMiCuentaSaldoIgnored,
  applyMiCuentaSaldoSuccess,
  beginMiCuentaSaldoRequest,
  messageFromMiCuentaHttp,
  MI_CUENTA_SALDO_QUERY,
  parseMiCuentaSaldoPayload,
  type MiCuentaSaldoState,
} from "@/lib/creditos/ui/mi-cuenta-saldo-model";

export type MiCuentaSaldoFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type MiCuentaSaldoRequestResult = {
  state: MiCuentaSaldoState;
  /** True si esta petición quedó obsoleta o abortada. */
  ignored: boolean;
};

/**
 * Puerta de commit del hook: solo la petición cuyo id sigue siendo el último
 * emitido puede actualizar el estado visible. Cubre el caso en que AbortController
 * no impidió que una respuesta antigua terminara.
 */
export function acceptMiCuentaSaldoResult(args: {
  requestId: number;
  latestRequestId: number;
  result: MiCuentaSaldoRequestResult;
}): MiCuentaSaldoState | null {
  if (args.requestId !== args.latestRequestId) return null;
  return args.result.state;
}

/**
 * Ejecuta una consulta mi-cuenta y aplica el resultado solo si `requestId`
 * sigue siendo el último conocido en `state.latestRequestId` al inicio
 * (el caller debe haber llamado `beginMiCuentaSaldoRequest` antes).
 */
export async function executeMiCuentaSaldoRequest(args: {
  state: MiCuentaSaldoState;
  requestId: number;
  signal: AbortSignal;
  fetchImpl?: MiCuentaSaldoFetch;
}): Promise<MiCuentaSaldoRequestResult> {
  const fetchFn = args.fetchImpl ?? fetch;
  let state = args.state;

  try {
    const res = await fetchFn(
      `/api/creditos/mi-cuenta?${MI_CUENTA_SALDO_QUERY}`,
      {
        cache: "no-store",
        signal: args.signal,
        credentials: "same-origin",
      },
    );

    if (args.signal.aborted || args.requestId !== state.latestRequestId) {
      return {
        state: applyMiCuentaSaldoIgnored(state, args.requestId),
        ignored: true,
      };
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (args.signal.aborted || args.requestId !== state.latestRequestId) {
      return {
        state: applyMiCuentaSaldoIgnored(state, args.requestId),
        ignored: true,
      };
    }

    if (res.status === 401) {
      state = applyMiCuentaSaldoFailure(state, args.requestId, {
        status: 401,
        message: messageFromMiCuentaHttp(401, json as ApiErrorBody | null),
      });
      return { state, ignored: false };
    }

    if (!res.ok) {
      state = applyMiCuentaSaldoFailure(state, args.requestId, {
        status: res.status,
        message: messageFromMiCuentaHttp(
          res.status,
          json as ApiErrorBody | null,
        ),
      });
      return { state, ignored: false };
    }

    const parsed = parseMiCuentaSaldoPayload(json);
    if (!parsed) {
      state = applyMiCuentaSaldoFailure(state, args.requestId, {
        status: res.status,
        message: "Respuesta de saldo inválida.",
      });
      return { state, ignored: false };
    }

    state = applyMiCuentaSaldoSuccess(state, args.requestId, parsed);
    return { state, ignored: false };
  } catch (error) {
    if (args.signal.aborted) {
      return {
        state: applyMiCuentaSaldoIgnored(state, args.requestId),
        ignored: true,
      };
    }
    if (args.requestId !== state.latestRequestId) {
      return { state, ignored: true };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return {
        state: applyMiCuentaSaldoIgnored(state, args.requestId),
        ignored: true,
      };
    }
    state = applyMiCuentaSaldoFailure(state, args.requestId, {
      status: 0,
      message: "Error de red al consultar el saldo.",
    });
    return { state, ignored: false };
  }
}

/** Helper de tests: begin + execute en un paso. */
export async function runMiCuentaSaldoRefresh(args: {
  state: MiCuentaSaldoState;
  requestId: number;
  signal: AbortSignal;
  fetchImpl?: MiCuentaSaldoFetch;
}): Promise<MiCuentaSaldoRequestResult> {
  const started = beginMiCuentaSaldoRequest(args.state, args.requestId);
  return executeMiCuentaSaldoRequest({
    ...args,
    state: started,
  });
}
