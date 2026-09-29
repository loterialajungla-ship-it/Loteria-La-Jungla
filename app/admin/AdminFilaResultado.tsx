"use client";

import { useState } from "react";

type AnimalOpcion = {
  numero: string;
  nombre: string;
};

type Props = {
  fecha: string;
  hora: number;
  horaLabel: string;
  animales: AnimalOpcion[];
  numeroInicial: string;
};

export function AdminFilaResultado({
  fecha,
  hora,
  horaLabel,
  animales,
  numeroInicial,
}: Props) {
  const [numero, setNumero] = useState(numeroInicial);
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">(
    "idle",
  );
  const [mensaje, setMensaje] = useState("");

  async function guardar() {
    if (!numero) {
      setEstado("error");
      setMensaje("Elige un animalito.");
      return;
    }

    setEstado("guardando");
    setMensaje("");

    try {
      const res = await fetch("/api/admin/resultados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, hora, numero }),
      });

      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        setEstado("error");
        setMensaje(data.error ?? "No se pudo guardar.");
        return;
      }

      setEstado("ok");
      setMensaje("Guardado.");
    } catch {
      setEstado("error");
      setMensaje("Error de red.");
    }
  }

  return (
    <li className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-emerald-800">{horaLabel}</p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
          Animalito
          <select
            value={numero}
            onChange={(e) => {
              setNumero(e.target.value);
              setEstado("idle");
              setMensaje("");
            }}
            className="rounded-xl border border-stone-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="">— Seleccionar —</option>
            {animales.map((animal) => (
              <option key={animal.numero} value={animal.numero}>
                {animal.numero} - {animal.nombre}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={guardar}
          disabled={estado === "guardando"}
          className="rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {estado === "guardando" ? "Guardando…" : "Guardar"}
        </button>

        {mensaje ? (
          <p
            className={`text-sm font-medium ${
              estado === "ok" ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {mensaje}
          </p>
        ) : null}
      </div>
    </li>
  );
}
