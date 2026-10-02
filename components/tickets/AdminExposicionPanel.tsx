"use client";

import { useCallback, useState } from "react";
import { ExposureTable } from "@/components/tickets/ExposureTable";
import type { ExposicionSorteo } from "@/lib/tickets/aggregate-exposure";
import { etiquetaHora } from "@/components/tickets/pos-state";
import { resumenExposicionCompacto } from "@/app/admin/admin-resultados-ui";

type Props = {
  fecha: string;
  hora: number;
  resultadoLabel: string | null;
  /** Notifica al padre cuando hay datos de exposición (para el resumen compacto). */
  onResumen?: (resumen: { ticketsAfectados: number; totalApostado: string } | null) => void;
};

export function AdminExposicionPanel({
  fecha,
  hora,
  resultadoLabel,
  onResumen,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExposicionSorteo | null>(null);

  const aplicarData = useCallback(
    (exposicion: ExposicionSorteo) => {
      setData(exposicion);
      onResumen?.({
        ticketsAfectados: exposicion.ticketsAfectados,
        totalApostado: exposicion.totalApostado,
      });
    },
    [onResumen],
  );

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/exposicion?fecha=${encodeURIComponent(fecha)}&hora=${hora}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        exposicion?: ExposicionSorteo;
        error?: { message?: string };
      };

      if (res.status === 401 || res.status === 403) {
        setError("No autorizado. Inicia sesión como ADMIN.");
        onResumen?.(null);
        return;
      }
      if (!res.ok || !json.exposicion) {
        setError(json.error?.message ?? "No se pudo cargar la exposición.");
        return;
      }
      aplicarData(json.exposicion);
    } catch {
      setError("No se pudo cargar la exposición.");
    } finally {
      setCargando(false);
    }
  }

  async function onToggle() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    if (!data) {
      await cargar();
    }
  }

  const resumen =
    data != null
      ? resumenExposicionCompacto({
          ticketsAfectados: data.ticketsAfectados,
          totalApostado: data.totalApostado,
        })
      : null;

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100"
        >
          {abierto ? "Ocultar apuestas" : "Ver apuestas"}
        </button>
        {resumen ? (
          <span className="text-xs font-medium tabular-nums text-stone-600">
            {resumen}
          </span>
        ) : null}
      </div>

      {abierto ? (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-emerald-900">
              {etiquetaHora(hora)} — Apuestas / exposición
            </p>
            <button
              type="button"
              disabled={cargando}
              onClick={cargar}
              className="text-sm font-semibold text-emerald-800 underline underline-offset-2 disabled:opacity-50"
            >
              {cargando ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          <p className="mt-2 text-sm text-stone-700">
            {resultadoLabel ? (
              <>
                Resultado publicado:{" "}
                <strong className="text-stone-900">{resultadoLabel}</strong>
              </>
            ) : (
              <span className="font-medium text-amber-800">
                Resultado pendiente
              </span>
            )}
          </p>

          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          {cargando && !data ? (
            <p className="mt-3 text-sm text-stone-500">Cargando exposición…</p>
          ) : null}

          {data ? (
            <div className="mt-3">
              <ExposureTable exposicion={data} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
