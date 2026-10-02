"use client";

import { useState } from "react";
import {
  eliminarLinea,
  etiquetaHora,
  normalizarImporteUi,
  upsertLinea,
} from "@/components/tickets/pos-state";
import type { PosApuestas } from "@/components/tickets/pos-state";

export type AnimalOpcion = {
  numero: string;
  nombre: string;
};

type Props = {
  hora: number;
  animales: AnimalOpcion[];
  apuestasHora: Record<string, string>;
  onChange: (siguiente: PosApuestas) => void;
  apuestas: PosApuestas;
  disabled?: boolean;
};

export function HourBetSection({
  hora,
  animales,
  apuestasHora,
  onChange,
  apuestas,
  disabled,
}: Props) {
  const [numero, setNumero] = useState("");
  const [importe, setImporte] = useState("");

  const lineas = Object.entries(apuestasHora).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  let totalCentavos = 0;
  for (const [, imp] of lineas) {
    const n = normalizarImporteUi(imp);
    if (!n) continue;
    const [e, f = "00"] = n.split(".");
    totalCentavos += Number(e) * 100 + Number(f);
  }
  const totalHora = `${Math.floor(totalCentavos / 100)}.${String(totalCentavos % 100).padStart(2, "0")}`;

  function agregar() {
    const imp = normalizarImporteUi(importe);
    if (!numero || !imp) return;
    onChange(upsertLinea(apuestas, hora, numero, imp));
    setImporte("");
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-emerald-900">{etiquetaHora(hora)}</h2>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-stone-700">
          Animal
          <select
            value={numero}
            disabled={disabled}
            onChange={(e) => setNumero(e.target.value)}
            className="rounded-xl border border-stone-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="">— Seleccionar —</option>
            {animales.map((a) => (
              <option key={a.numero} value={a.numero}>
                {a.numero} - {a.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-full flex-col gap-1 text-sm font-medium text-stone-700 sm:w-36">
          Importe
          <span className="flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2.5 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-200">
            <span className="text-stone-500" aria-hidden>
              $
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              disabled={disabled}
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              className="w-full min-w-0 bg-transparent text-base outline-none"
              aria-label={`Importe para ${etiquetaHora(hora)}`}
            />
          </span>
        </label>

        <button
          type="button"
          disabled={disabled || !numero || !normalizarImporteUi(importe)}
          onClick={agregar}
          className="rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Agregar
        </button>
      </div>

      {lineas.length > 0 ? (
        <ul className="mt-4 divide-y divide-stone-100 rounded-xl border border-stone-100">
          {lineas.map(([num, imp]) => {
            const animal = animales.find((a) => a.numero === num);
            const etiqueta = animal
              ? `${animal.numero} - ${animal.nombre}`
              : num;
            return (
              <li
                key={num}
                className="flex items-center justify-between gap-3 px-3 py-3 text-base"
              >
                <span className="font-medium text-stone-800">{etiqueta}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums font-semibold">${imp}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onChange(eliminarLinea(apuestas, hora, num))
                    }
                    className="text-sm font-semibold text-red-700 underline underline-offset-2 disabled:opacity-50"
                  >
                    Quitar
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-500">Sin apuestas en esta hora.</p>
      )}

      <p className="mt-3 text-sm font-semibold text-stone-700">
        Total hora:{" "}
        <span className="tabular-nums text-emerald-900">${totalHora}</span>
      </p>
    </section>
  );
}
