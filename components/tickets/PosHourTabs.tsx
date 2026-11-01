"use client";

import React from "react";
import { cn } from "@/components/ui/cn";
import { etiquetaHora } from "@/components/tickets/pos-state";

export type PosHoraChip = {
  hora: number;
  abierta: boolean;
  motivoCierre?: "HORA_LLEGADA" | "RESULTADO_PUBLICADO";
};

type Props = {
  horas: PosHoraChip[];
  horaActiva: number | null;
  /** Conteos de selecciones (claves) por hora */
  conteos: Record<string, number>;
  disabled?: boolean;
  actualizando?: boolean;
  onSelectHora: (hora: number) => void;
  onActualizar: () => void;
  /** id del tabpanel asociado (p. ej. grid de animales) */
  panelId?: string;
};

function etiquetaEstado(h: PosHoraChip): string {
  if (h.abierta) return "Abierta";
  if (h.motivoCierre === "RESULTADO_PUBLICADO") return "Cerrada · resultado";
  return "Cerrada";
}

export function PosHourTabs({
  horas,
  horaActiva,
  conteos,
  disabled,
  actualizando,
  onSelectHora,
  onActualizar,
  panelId,
}: Props) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-semibold text-ink">Hora del sorteo</p>
        <button
          type="button"
          disabled={disabled || actualizando}
          onClick={onActualizar}
          className="text-sm font-semibold text-brand-800 underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50"
        >
          {actualizando ? "Actualizando…" : "Actualizar horas"}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Horas del sorteo"
        className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-1"
      >
        {horas.map((h) => {
          const activa = horaActiva === h.hora;
          const cerrada = !h.abierta;
          const n = conteos[String(h.hora)] ?? 0;
          const tieneLineas = n > 0;

          return (
            <button
              key={h.hora}
              type="button"
              role="tab"
              id={`pos-hora-tab-${h.hora}`}
              aria-selected={activa}
              aria-controls={panelId}
              aria-disabled={cerrada}
              disabled={cerrada || disabled}
              title={
                cerrada
                  ? h.motivoCierre === "RESULTADO_PUBLICADO"
                    ? "Cerrado — resultado publicado"
                    : "Cerrado — el sorteo ya comenzó"
                  : tieneLineas
                    ? `${n} selección${n === 1 ? "" : "es"}`
                    : undefined
              }
              onClick={() => onSelectHora(h.hora)}
              className={cn(
                "relative min-h-11 shrink-0 rounded-lj-md px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                cerrada &&
                  "cursor-not-allowed border border-border bg-surface-muted text-ink-muted",
                !cerrada &&
                  activa &&
                  "bg-brand-800 text-white shadow-surface",
                !cerrada &&
                  !activa &&
                  "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
              )}
            >
              <span
                className={cn(
                  "block text-sm font-bold tabular-nums leading-tight",
                  cerrada && "line-through",
                )}
              >
                {etiquetaHora(h.hora)}
              </span>
              <span
                className={cn(
                  "mt-0.5 block text-[10px] font-semibold uppercase tracking-wide",
                  cerrada
                    ? "text-ink-muted"
                    : activa
                      ? "text-brand-100"
                      : "text-brand-700",
                )}
              >
                {etiquetaEstado(h)}
              </span>
              {tieneLineas ? (
                <span
                  className={cn(
                    "mt-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    activa
                      ? "bg-white/20 text-white"
                      : cerrada
                        ? "bg-border text-ink-muted"
                        : "bg-brand-100 text-brand-900",
                  )}
                >
                  {n}
                  <span className="sr-only">
                    {n === 1 ? " selección" : " selecciones"}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
