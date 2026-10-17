"use client";

import { useMemo, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui";
import { normalizarImporteUi } from "@/components/tickets/pos-state";
import type { AnimalOpcion } from "@/components/tickets/animal-types";

type Props = {
  animales: AnimalOpcion[];
  /** numero → importe (raw UI) de la hora activa */
  seleccion: Record<string, string>;
  disabled?: boolean;
  onToggle: (numero: string) => void;
  onImporteChange: (numero: string, importe: string) => void;
};

/** Filtra por número o nombre; no muta selecciones (solo vista). */
export function coincideBusquedaAnimal(
  animal: AnimalOpcion,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    animal.numero.toLowerCase().includes(needle) ||
    animal.nombre.toLowerCase().includes(needle)
  );
}

export function AnimalGrid({
  animales,
  seleccion,
  disabled,
  onToggle,
  onImporteChange,
}: Props) {
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(
    () => animales.filter((a) => coincideBusquedaAnimal(a, busqueda)),
    [animales, busqueda],
  );

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        name="buscar-animal"
        label="Buscar animal"
        placeholder="Número o nombre…"
        value={busqueda}
        disabled={disabled}
        onChange={(e) => setBusqueda(e.target.value)}
        autoComplete="off"
        hint={
          busqueda.trim()
            ? `${filtrados.length} de ${animales.length} animales`
            : undefined
        }
      />

      {filtrados.length === 0 ? (
        <p className="rounded-lj-md border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          Ningún animal coincide con «{busqueda.trim()}».
        </p>
      ) : (
        <ul
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="Catálogo de animales"
        >
          {filtrados.map((animal) => {
            const seleccionado = animal.numero in seleccion;
            const importe = seleccion[animal.numero] ?? "";
            const importeOk = Boolean(normalizarImporteUi(importe));
            const importeInvalido =
              seleccionado && importe.trim() !== "" && !importeOk;

            return (
              <li key={animal.numero} className="min-w-0">
                <div
                  className={cn(
                    "flex h-full flex-col rounded-lj-md border bg-surface p-2 shadow-surface transition-colors",
                    seleccionado
                      ? "border-brand-800 ring-2 ring-brand-600/30"
                      : "border-border hover:border-border-strong",
                    disabled && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={seleccionado}
                    onClick={() => onToggle(animal.numero)}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lj-sm px-1.5 py-1.5 text-left",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-1">
                      <span className="font-mono text-base font-bold tabular-nums text-ink">
                        {animal.numero}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-bold uppercase tracking-wide",
                          seleccionado
                            ? "text-brand-800"
                            : "text-ink-muted",
                        )}
                      >
                        {seleccionado ? "Sí" : "No"}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-ink-secondary">
                      {animal.nombre}
                    </span>
                  </button>

                  {seleccionado ? (
                    <label className="mt-1.5 flex flex-col gap-0.5 border-t border-border px-1 pt-1.5">
                      <span className="text-[11px] font-semibold text-ink-secondary">
                        Importe ($)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={disabled}
                        value={importe}
                        placeholder="0.00"
                        aria-invalid={importeInvalido || (!importeOk && importe.trim() === "")}
                        aria-label={`Importe para ${animal.numero} ${animal.nombre}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onImporteChange(animal.numero, e.target.value)
                        }
                        className={cn(
                          "min-h-10 w-full rounded-lj-sm border bg-surface px-2 py-1.5 font-mono text-base tabular-nums outline-none",
                          "focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                          importeInvalido || (!importeOk && importe.trim() === "")
                            ? "border-danger-700"
                            : "border-border-strong",
                        )}
                      />
                      {importeInvalido ? (
                        <span className="text-[11px] font-medium text-danger-700">
                          Importe no válido
                        </span>
                      ) : !importeOk ? (
                        <span className="text-[11px] font-medium text-accent-800">
                          Indica un importe
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
