"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";
import type { CreditosConfigPublic } from "@/lib/creditos/ui/api-types";
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import {
  caracasLocalToIsoOffset,
  formatearInstanteVe,
  isoToCaracasLocalParts,
} from "@/lib/creditos/ui/caracas-instant";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";

const UMBRAL_RE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

function sameInstant(a: string, b: string): boolean {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return !Number.isNaN(da) && da === db;
}

type Props = {
  initial: CreditosConfigPublic;
  onSaved: (config: CreditosConfigPublic) => void;
  onSessionExpired?: () => void;
};

export function CreditosConfigForm({
  initial,
  onSaved,
  onSessionExpired,
}: Props) {
  const [controlActivo, setControlActivo] = useState(initial.controlActivo);
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("00:00");
  const [limpiarInicio, setLimpiarInicio] = useState(false);
  const [umbral, setUmbral] = useState(initial.umbralSaldoBajo ?? "");
  const [limpiarUmbral, setLimpiarUmbral] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const guardRef = useRef(createSubmitGuard());

  useEffect(() => {
    setControlActivo(initial.controlActivo);
    setLimpiarInicio(false);
    setLimpiarUmbral(false);
    setUmbral(initial.umbralSaldoBajo ?? "");
    if (initial.inicioEn) {
      const parts = isoToCaracasLocalParts(initial.inicioEn);
      if (parts) {
        setFecha(parts.fecha);
        setHora(parts.hora);
      }
    } else {
      setFecha("");
      setHora("00:00");
    }
  }, [initial]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!guardRef.current.tryAcquire()) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      const body: Record<string, unknown> = {};

      // Solo envía controlActivo si el checkbox cambió respecto al servidor.
      if (controlActivo !== initial.controlActivo) {
        body.controlActivo = controlActivo;
      }

      if (limpiarInicio) {
        body.inicioEn = null;
      } else if (fecha.trim()) {
        const iso = caracasLocalToIsoOffset(fecha, hora || "00:00");
        if (!iso) {
          setError("Fecha/hora de inicio inválida (America/Caracas).");
          return;
        }
        if (!initial.inicioEn || !sameInstant(iso, initial.inicioEn)) {
          body.inicioEn = iso;
        }
      }

      if (limpiarUmbral) {
        body.umbralSaldoBajo = null;
      } else if (umbral.trim()) {
        if (!UMBRAL_RE.test(umbral.trim())) {
          setError("Umbral inválido: no negativo, máximo 2 decimales.");
          return;
        }
        if (umbral.trim() !== (initial.umbralSaldoBajo ?? "")) {
          body.umbralSaldoBajo = umbral.trim();
        }
      }

      if (Object.keys(body).length === 0) {
        setError("No hay cambios para guardar.");
        return;
      }

      if (body.controlActivo === true) {
        const inicioEfectivo =
          body.inicioEn !== undefined
            ? body.inicioEn
            : limpiarInicio
              ? null
              : initial.inicioEn;
        if (!inicioEfectivo) {
          setError(
            "No se puede activar el control sin una fecha/hora de inicio explícita.",
          );
          return;
        }
        const okConfirm = window.confirm(
          "¿Activar el control de créditos?\n\n" +
            "Solo las ventas de VENDEDOR con Ticket.createdAt ≥ inicioEn consumirán saldo.\n" +
            "No hay deducciones retroactivas. Asegúrate de haber preparado los saldos iniciales.",
        );
        if (!okConfirm) return;
      }

      const res = await fetch("/api/admin/creditos/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiErrorBody & {
        config?: CreditosConfigPublic;
      };
      if (res.status === 401) {
        setError("Sesión expirada. Vuelve a iniciar sesión.");
        onSessionExpired?.();
        return;
      }
      if (res.status === 403) {
        setError("No tienes permiso.");
        onSessionExpired?.();
        return;
      }
      if (!res.ok || !data.config) {
        setError(data.error?.message ?? "No se pudo guardar la configuración.");
        return;
      }
      setOk("Configuración actualizada.");
      onSaved(data.config);
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      guardRef.current.release();
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void guardar(e)}>
        <h2 className="text-lg font-bold text-ink">Configuración de créditos</h2>
        <p className="mt-1 text-sm text-ink-muted">
          La fecha de inicio se interpreta en America/Caracas y se envía como
          instante ISO con zona. Activar el control no es automático al editar
          otros campos.
        </p>

        {!initial.controlActivo ? (
          <div className="mt-3">
            <Alert variant="warning" title="Control desactivado">
              Las ventas no consumen créditos mientras el control esté apagado o
              falte inicioEn.
            </Alert>
          </div>
        ) : null}

        {!initial.inicioEn ? (
          <div className="mt-3">
            <Alert variant="info" title="Sin fecha de inicio">
              No hay inicioEn configurado. No se puede activar el control sin
              fijar un instante válido.
            </Alert>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            Inicio actual:{" "}
            <strong className="text-ink">
              {formatearInstanteVe(initial.inicioEn)}
            </strong>{" "}
            (Caracas)
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={controlActivo}
              disabled={busy}
              onChange={(e) => setControlActivo(e.target.checked)}
            />
            Control de créditos activo
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            label="Fecha de inicio (Caracas)"
            type="date"
            value={fecha}
            disabled={busy || limpiarInicio}
            onChange={(e) => setFecha(e.target.value)}
          />
          <Input
            label="Hora de inicio (Caracas)"
            type="time"
            value={hora}
            disabled={busy || limpiarInicio}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={limpiarInicio}
            disabled={busy}
            onChange={(e) => setLimpiarInicio(e.target.checked)}
          />
          Borrar fecha de inicio (inicioEn = null)
        </label>

        <div className="mt-4">
          <Input
            label="Umbral de saldo bajo"
            type="text"
            inputMode="decimal"
            placeholder="p. ej. 50.00"
            value={umbral}
            disabled={busy || limpiarUmbral}
            onChange={(e) => setUmbral(e.target.value)}
            className="font-mono"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={limpiarUmbral}
              disabled={busy}
              onChange={(e) => setLimpiarUmbral(e.target.checked)}
            />
            Quitar umbral
          </label>
        </div>

        {error ? (
          <div className="mt-3">
            <Alert variant="error" title="Error">
              {error}
            </Alert>
          </div>
        ) : null}
        {ok ? (
          <div className="mt-3">
            <Alert variant="success" title="Correcto">
              {ok}
            </Alert>
          </div>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={busy}
          className="mt-4 sm:w-auto"
          fullWidth
        >
          {busy ? "Guardando…" : "Guardar configuración"}
        </Button>
      </form>
    </Card>
  );
}
