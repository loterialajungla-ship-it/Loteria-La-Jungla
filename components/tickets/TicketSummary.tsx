"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import {
  apuestasALineasApi,
  contarLineas,
  eliminarLinea,
  etiquetaHora,
  formatearFechaUi,
  normalizarImporteUi,
  puedeCrearTicket,
  totalOrientativo,
  upsertLinea,
} from "@/components/tickets/pos-state";
import type { PosApuestas } from "@/components/tickets/pos-state";
import type { AnimalOpcion } from "@/components/tickets/animal-types";
import { useVisualViewportBottomMetrics } from "@/lib/ui/use-visual-viewport-bottom";
import { scrollFocusedControlIntoView } from "@/lib/ui/scroll-focused-control";

type Props = {
  fechaJuego: string;
  apuestas: PosApuestas;
  animales: AnimalOpcion[];
  creando: boolean;
  onChange: (siguiente: PosApuestas) => void;
  onCrear: () => void;
};

function nombreAnimal(
  animales: AnimalOpcion[],
  numero: string,
): string {
  return animales.find((a) => a.numero === numero)?.nombre ?? numero;
}

function DetalleLineas({
  fechaJuego,
  apuestas,
  animales,
  creando,
  onChange,
}: Omit<Props, "onCrear">) {
  const horas = Object.keys(apuestas)
    .map(Number)
    .sort((a, b) => a - b);

  if (horas.length === 0 || contarLineas(apuestas) === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Aún no hay selecciones. Elige una hora y marca animales con importe.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-secondary">
        Fecha de juego:{" "}
        <strong className="text-ink">{formatearFechaUi(fechaJuego)}</strong>
      </p>

      {horas.map((hora) => {
        const porHora = apuestas[String(hora)] ?? {};
        const numeros = Object.keys(porHora).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        if (numeros.length === 0) return null;

        return (
          <section key={hora} className="rounded-lj-md border border-border bg-surface-muted/60 p-3">
            <h3 className="text-sm font-bold text-brand-900">
              {etiquetaHora(hora)}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {numeros.map((numero) => {
                const importe = porHora[numero] ?? "";
                const ok = Boolean(normalizarImporteUi(importe));
                const invalido = importe.trim() !== "" && !ok;
                const nombre = nombreAnimal(animales, numero);

                return (
                  <li
                    key={`${hora}-${numero}`}
                    className="flex flex-col gap-2 rounded-lj-sm border border-border bg-surface p-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold tabular-nums text-ink">
                        {numero}{" "}
                        <span className="font-sans font-semibold text-ink-secondary">
                          {nombre}
                        </span>
                      </p>
                      {!ok ? (
                        <p className="mt-0.5 text-xs font-medium text-accent-800">
                          {invalido ? "Importe no válido" : "Falta importe"}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex min-w-0 flex-1 items-center gap-1 sm:w-28 sm:flex-none">
                        <span className="sr-only">
                          Importe {numero} {etiquetaHora(hora)}
                        </span>
                        <span className="text-sm text-ink-muted" aria-hidden>
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={creando}
                          value={importe}
                          aria-invalid={invalido || !ok}
                          onFocus={(e) => {
                            scrollFocusedControlIntoView(e.currentTarget);
                          }}
                          onChange={(e) =>
                            onChange(
                              upsertLinea(apuestas, hora, numero, e.target.value),
                            )
                          }
                          className={cn(
                            "min-h-11 w-full min-w-0 max-w-full rounded-lj-sm border border-border-strong bg-surface px-2 py-1.5 font-mono text-base tabular-nums outline-none",
                            "focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                            invalido || !ok
                              ? "border-danger-700"
                              : "border-border-strong",
                          )}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={creando}
                        onClick={() =>
                          onChange(eliminarLinea(apuestas, hora, numero))
                        }
                        className="text-danger-700 hover:bg-danger-50 hover:text-danger-800"
                      >
                        Quitar
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ResumenAcciones({
  apuestas,
  creando,
  onCrear,
  className,
}: {
  apuestas: PosApuestas;
  creando: boolean;
  onCrear: () => void;
  className?: string;
}) {
  const total = totalOrientativo(apuestas);
  const validas = apuestasALineasApi(apuestas).length;
  const seleccionadas = contarLineas(apuestas);
  const ok = puedeCrearTicket(apuestas);
  const pendientes = seleccionadas - validas;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <p className="text-sm text-ink-secondary">
          {validas === 1
            ? "1 línea lista"
            : `${validas} líneas listas`}
          {pendientes > 0
            ? ` · ${pendientes} sin importe válido`
            : null}
        </p>
        <p className="text-2xl font-bold tabular-nums text-ink">
          Total jugado: ${total}
        </p>
        <p className="text-xs text-ink-muted">
          Total orientativo; el servidor confirma el monto final.
        </p>
      </div>
      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        disabled={!ok || creando}
        onClick={onCrear}
      >
        {creando ? "Creando ticket…" : "Crear ticket"}
      </Button>
    </div>
  );
}

/**
 * Resumen del ticket: panel lateral en escritorio; barra + panel en móvil.
 */
export function TicketSummary({
  fechaJuego,
  apuestas,
  animales,
  creando,
  onChange,
  onCrear,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const panelId = useId();
  const expandirRef = useRef<HTMLButtonElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const { bottomInset, panelMaxHeightPx } =
    useVisualViewportBottomMetrics(0.48);
  const total = totalOrientativo(apuestas);
  const validas = apuestasALineasApi(apuestas).length;

  useEffect(() => {
    if (!abierto) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", onKey);
    cerrarRef.current?.focus();

    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  function cerrarPanel() {
    setAbierto(false);
    expandirRef.current?.focus();
  }

  return (
    <>
      {/* Escritorio: panel sticky en columna (lo monta el layout padre) */}
      <aside className="hidden lg:block">
        <div className="sticky top-36 rounded-lj-lg border border-border bg-surface p-4 shadow-card">
          <h2 className="text-lg font-bold text-ink">Resumen del ticket</h2>
          <div className="mt-4 max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain pr-1">
            <DetalleLineas
              fechaJuego={fechaJuego}
              apuestas={apuestas}
              animales={animales}
              creando={creando}
              onChange={onChange}
            />
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <ResumenAcciones
              apuestas={apuestas}
              creando={creando}
              onCrear={onCrear}
            />
          </div>
        </div>
      </aside>

      {/* Móvil / tablet: barra inferior elevada con visualViewport + safe-area */}
      <div className="lg:hidden">
        {abierto ? (
          <div
            className="fixed inset-0 z-30 bg-ink/40"
            aria-hidden
            onClick={cerrarPanel}
          />
        ) : null}

        <div
          data-pos-bottom-bar=""
          className={cn(
            "fixed inset-x-0 z-30 border-t border-border bg-surface shadow-card",
            "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
          )}
          style={{ bottom: bottomInset }}
        >
          <div
            id={panelId}
            role={abierto ? "dialog" : undefined}
            aria-modal={abierto ? true : undefined}
            aria-label="Detalle del ticket"
            hidden={!abierto}
            className={cn(
              "overflow-y-auto overscroll-contain border-b border-border px-4 py-3",
              !abierto && "hidden",
              panelMaxHeightPx == null && "max-h-[min(55dvh,55vh)]",
            )}
            style={
              abierto && panelMaxHeightPx != null
                ? { maxHeight: panelMaxHeightPx }
                : undefined
            }
          >
            <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
              <h2 className="text-base font-bold text-ink">
                Resumen del ticket
              </h2>
              <Button
                ref={cerrarRef}
                type="button"
                variant="ghost"
                size="sm"
                onClick={cerrarPanel}
              >
                Cerrar
              </Button>
            </div>
            <div className="mx-auto mt-3 max-w-lg">
              <DetalleLineas
                fechaJuego={fechaJuego}
                apuestas={apuestas}
                animales={animales}
                creando={creando}
                onChange={onChange}
              />
            </div>
          </div>

          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
            <button
              ref={expandirRef}
              type="button"
              className="min-h-11 min-w-0 flex-1 rounded-lj-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              aria-expanded={abierto}
              aria-controls={panelId}
              onClick={() => setAbierto((v) => !v)}
            >
              <p className="text-xs font-medium text-ink-muted">
                {validas} línea{validas === 1 ? "" : "s"} · ver detalle
              </p>
              <p className="truncate text-lg font-bold tabular-nums text-ink">
                ${total}
              </p>
            </button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!puedeCrearTicket(apuestas) || creando}
              onClick={onCrear}
              className="min-h-11 shrink-0"
            >
              {creando ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Mensaje de ayuda cuando no se puede emitir (opcional en padre). */
export function TicketSummaryHint({ apuestas }: { apuestas: PosApuestas }) {
  if (puedeCrearTicket(apuestas)) return null;
  if (contarLineas(apuestas) === 0) return null;
  return (
    <Alert variant="warning" title="Revisa los importes">
      Hay selecciones sin importe válido. Complétalas o quítalas antes de crear
      el ticket.
    </Alert>
  );
}
