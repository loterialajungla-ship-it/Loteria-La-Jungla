"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MOTIVO_ANULACION_MAX } from "@/lib/tickets/admin-ticket-constants";
import { Alert, Button, Textarea } from "@/components/ui";

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
    if (enviando) return;
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
        <Button
          type="button"
          variant="danger"
          size="lg"
          fullWidth
          onClick={() => setPaso("confirmar")}
        >
          Anular ticket
        </Button>
      </div>
    );
  }

  if (paso === "confirmar") {
    return (
      <div
        role="dialog"
        aria-labelledby="anular-confirm-title"
        className="mt-8 rounded-lj-lg border border-danger-100 bg-danger-50 p-4"
      >
        <h2
          id="anular-confirm-title"
          className="text-lg font-bold text-danger-800"
        >
          ¿Seguro que quieres anular este ticket?
        </h2>
        <dl className="mt-3 space-y-1 text-sm text-ink">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Número</dt>
            <dd className="font-mono font-semibold">{numeroVisible}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Fecha</dt>
            <dd className="font-semibold">{fechaJuego}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Total jugado</dt>
            <dd className="font-semibold tabular-nums">${totalApostado}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm font-medium text-danger-800">
          Esta acción no elimina el ticket. Quedará registrado como ANULADO.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="danger"
            size="md"
            className="flex-1"
            onClick={() => setPaso("motivo")}
          >
            Continuar
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={reset}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-lj-lg border border-danger-100 bg-danger-50 p-4">
      <h2 className="text-lg font-bold text-danger-800">Motivo de anulación</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Ejemplos: Error de digitación · Cliente pidió cancelación · Ticket
        generado incorrectamente
      </p>
      <Textarea
        name="motivo-anulacion"
        label="Motivo"
        variant="danger"
        value={motivo}
        maxLength={MOTIVO_ANULACION_MAX}
        disabled={enviando}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        placeholder="Describe el motivo…"
        containerClassName="mt-3"
      />
      <p className="mt-1 text-right text-xs text-ink-muted">
        {motivo.trim().length}/{MOTIVO_ANULACION_MAX}
      </p>

      {error ? (
        <div className="mt-2">
          <Alert variant="error" title="Error">
            {error}
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="danger"
          size="md"
          className="flex-1"
          disabled={enviando || !motivo.trim()}
          onClick={() => void confirmarAnulacion()}
        >
          {enviando ? "Anulando…" : "Confirmar anulación"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="flex-1"
          disabled={enviando}
          onClick={reset}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
