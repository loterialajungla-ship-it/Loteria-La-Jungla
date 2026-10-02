"use client";

import { useMemo, useState } from "react";
import { AdminExposicionPanel } from "@/components/tickets/AdminExposicionPanel";
import {
  etiquetaResultadoAnimal,
  formatResultadoLabel,
  mensajeErrorResultado,
  parseResultadoApiOk,
  resumenExposicionCompacto,
  type AnimalOpcion,
  type ResultadoActual,
} from "@/app/admin/admin-resultados-ui";

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
  const inicial = useMemo(
    () => etiquetaResultadoAnimal(animales, numeroInicial),
    [animales, numeroInicial],
  );

  const [numero, setNumero] = useState(numeroInicial);
  const [resultadoActual, setResultadoActual] = useState<ResultadoActual | null>(
    inicial,
  );
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">(
    "idle",
  );
  const [mensaje, setMensaje] = useState("");
  const [resumenApuestas, setResumenApuestas] = useState<string | null>(null);

  const resultadoLabel = formatResultadoLabel(resultadoActual);
  const tieneResultado = resultadoActual != null;

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

      const data: unknown = await res.json().catch(() => ({}));

      if (res.status === 401 || res.status === 403) {
        setEstado("error");
        setMensaje("No autorizado. Inicia sesión como ADMIN.");
        return;
      }

      if (!res.ok) {
        setEstado("error");
        setMensaje(mensajeErrorResultado(data as { error?: string }));
        return;
      }

      const ok = parseResultadoApiOk(data);
      if (!ok) {
        setEstado("error");
        setMensaje("Respuesta inválida del servidor.");
        return;
      }

      setResultadoActual({
        numero: ok.resultado.numero,
        nombre: ok.resultado.nombre,
      });
      setNumero(ok.resultado.numero);
      setEstado("ok");
      setMensaje("Resultado guardado.");
    } catch {
      setEstado("error");
      setMensaje("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
    }
  }

  return (
    <li className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-emerald-900">{horaLabel}</p>
          <p className="mt-1 text-sm text-stone-600">
            <span className="font-medium text-stone-500">Resultado:</span>{" "}
            {tieneResultado ? (
              <span className="font-semibold text-stone-900">
                {resultadoLabel}
              </span>
            ) : (
              <span className="font-semibold text-amber-800">PENDIENTE</span>
            )}
          </p>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-stone-500">
            Estado: {tieneResultado ? "Publicado" : "Pendiente"}
          </p>
        </div>
        {resumenApuestas ? (
          <p className="text-xs font-medium tabular-nums text-stone-500">
            {resumenApuestas}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
          {tieneResultado ? "Modificar animalito" : "Animalito"}
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
          {estado === "guardando"
            ? "Guardando…"
            : tieneResultado
              ? "Actualizar resultado"
              : "Guardar resultado"}
        </button>

        {mensaje ? (
          <p
            role={estado === "error" ? "alert" : "status"}
            className={`text-sm font-medium ${
              estado === "ok" ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {mensaje}
          </p>
        ) : null}
      </div>

      <AdminExposicionPanel
        fecha={fecha}
        hora={hora}
        resultadoLabel={resultadoLabel}
        onResumen={(r) => {
          if (!r) {
            setResumenApuestas(null);
            return;
          }
          setResumenApuestas(resumenExposicionCompacto(r));
        }}
      />
    </li>
  );
}
