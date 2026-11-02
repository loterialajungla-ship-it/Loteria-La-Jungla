"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginMiCuentaSaldoRequest,
  initialMiCuentaSaldoState,
  resolvePosSaldoViewModel,
  type MiCuentaSaldoState,
  type PosSaldoViewModel,
} from "@/lib/creditos/ui/mi-cuenta-saldo-model";
import {
  acceptMiCuentaSaldoResult,
  executeMiCuentaSaldoRequest,
} from "@/lib/creditos/ui/mi-cuenta-saldo-request";

export type UseMiCuentaSaldoResult = {
  state: MiCuentaSaldoState;
  view: PosSaldoViewModel;
  refresh: () => Promise<void>;
};

/**
 * Consulta GET /api/creditos/mi-cuenta para el badge de saldo del POS.
 * Identidad = sesión; no acepta vendedorId. Sin localStorage.
 */
export function useMiCuentaSaldo(): UseMiCuentaSaldoResult {
  const [state, setState] = useState<MiCuentaSaldoState>(
    initialMiCuentaSaldoState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const started = beginMiCuentaSaldoRequest(stateRef.current, requestId);
    stateRef.current = started;
    setState(started);

    const result = await executeMiCuentaSaldoRequest({
      state: started,
      requestId,
      signal: ac.signal,
    });

    const accepted = acceptMiCuentaSaldoResult({
      requestId,
      latestRequestId: requestIdRef.current,
      result,
    });
    if (!accepted) {
      return;
    }

    stateRef.current = accepted;
    setState(accepted);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return {
    state,
    view: resolvePosSaldoViewModel(state),
    refresh,
  };
}
