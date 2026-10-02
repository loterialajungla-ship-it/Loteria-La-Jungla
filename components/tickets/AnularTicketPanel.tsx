"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MOTIVO_ANULACION_MAX } from "@/lib/tickets/admin-ticket-constants";

type Props = {
  ticketId: string;
  numeroVisible: string;
  fechaJuego: string;
  totalApostado: string;
};

type Paso = "idle" | "confirmar" | "motivo";

export function AnularTicketPanel({
  ticketId,
  numeroVisible,
  fechaJuego,
  totalApostado,
}: Props) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("idle");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPaso("idle");
    setMotivo("");
    setError(null);
  }

  async function confirmarAnulacion() {
    const trimmed = motivo.trim();
    if (!trimmed) {
      setError("El motivo es obligatorio.");
      return;
    }
    if (trimmed.length > MOTIVO_ANULACION_MAX) {
      setError(`Máximo ${MOTIVO_ANULACION_MAX} caracteres.`);
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: trimmed }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string; code?: string };
      };

      if (res.status === 401) {
        setError("Sesión expirada. Vuelve a iniciar sesión.");
        return;
      }
      if (res.status === 409) {
        setError(data.error?.message ?? "El ticket ya está anulado.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo anular el ticket.");
        return;
      }

      reset();
      router.refresh();
    } catch {
      setError("No se pudo anular el ticket. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (paso === "idle") {
    return (
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setPaso("confirmar")}
          className="w-full rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-base font-bold text-red-800 hover:bg-red-100"
        >
          Anular ticket
        </button>
      </div>
    );
  }

  if (paso === "confirmar") {
    return (
      <div
        role="dialog"
        aria-labelledby="anular-confirm-title"
        className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-4"
      >
        <h2
          id="anular-confirm-title"
          className="text-lg font-bold text-red-900"
        >
          ¿Seguro que quieres anular este ticket?
        </h2>
        <dl className="mt-3 space-y-1 text-sm text-stone-800">
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Número</dt>
            <dd className="font-mono font-semibold">{numeroVisible}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Fecha</dt>
            <dd className="font-semibold">{fechaJuego}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-600">Total jugado</dt>
            <dd className="font-semibold tabular-nums">${totalApostado}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm font-medium text-red-800">
          Esta acción no elimina el ticket. Quedará registrado como ANULADO.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setPaso("motivo")}
            className="flex-1 rounded-xl bg-red-800 px-4 py-3 text-sm font-bold text-white hover:bg-red-700"
          >
            Continuar
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-4">
      <h2 className="text-lg font-bold text-red-900">Motivo de anulación</h2>
      <p className="mt-1 text-sm text-stone-600">
        Ejemplos: Error de digitación · Cliente pidió cancelación · Ticket
        generado incorrectamente
      </p>
      <label className="mt-3 block text-sm font-medium text-stone-700">
        Motivo
        <textarea
          value={motivo}
          maxLength={MOTIVO_ANULACION_MAX}
          disabled={enviando}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-red-600 focus:ring-2 focus:ring-red-200"
          placeholder="Describe el motivo…"
        />
      </label>
      <p className="mt-1 text-right text-xs text-stone-500">
        {motivo.trim().length}/{MOTIVO_ANULACION_MAX}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={enviando || !motivo.trim()}
          onClick={() => void confirmarAnulacion()}
          className="flex-1 rounded-xl bg-red-800 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {enviando ? "Anulando…" : "Confirmar anulación"}
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={reset}
          className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
