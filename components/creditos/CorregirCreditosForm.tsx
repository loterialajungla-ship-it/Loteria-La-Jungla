"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, Input, Select } from "@/components/ui";
import type {
  ApiErrorBody,
  CreditoMovimientoPublic,
} from "@/lib/creditos/ui/api-types";
import { tipoMovimientoLabel } from "@/lib/creditos/ui/api-types";
import {
  fingerprintOperacionCredito,
  nuevaIdempotencyKeyCredito,
} from "@/lib/creditos/ui/idempotency";
import { isImporteCreditoValido } from "@/lib/creditos/ui/money-input";
import { formatearInstanteVe } from "@/lib/creditos/ui/caracas-instant";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";

type Props = {
  vendedorId: string;
  saldoDisponible: string;
  /** Movimientos de la página actual (candidatos a origen). */
  movimientos: CreditoMovimientoPublic[];
  onSuccess: () => void;
  onSessionExpired?: () => void;
};

export function CorregirCreditosForm({
  vendedorId,
  saldoDisponible,
  movimientos,
  onSuccess,
  onSessionExpired,
}: Props) {
  const [movimientoOrigenId, setMovimientoOrigenId] = useState("");
  const [importe, setImporte] = useState("");
  const [efecto, setEfecto] = useState<"AUMENTAR" | "DISMINUIR">("DISMINUIR");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const guardRef = useRef(createSubmitGuard());

  // Candidatos en esta página: el backend permite cualquier movimiento del
  // vendedor, pero rechaza un segundo CORRECCION sobre el mismo origen.
  // Solo podemos ocultar orígenes ya corregidos si la corrección está en esta página.
  const yaCorregidos = new Set(
    movimientos
      .filter((m) => m.tipo === "CORRECCION" && m.movimientoOrigenId)
      .map((m) => m.movimientoOrigenId as string),
  );
  const candidatos = movimientos.filter((m) => !yaCorregidos.has(m.id));
  const origen = candidatos.find((m) => m.id === movimientoOrigenId);

  function ensureKey(fp: string): string {
    if (fingerprintRef.current !== fp || !keyRef.current) {
      keyRef.current = nuevaIdempotencyKeyCredito();
      fingerprintRef.current = fp;
    }
    return keyRef.current;
  }

  function invalidateKey() {
    fingerprintRef.current = null;
    keyRef.current = null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guardRef.current.tryAcquire()) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      if (!movimientoOrigenId) {
        setError("Selecciona el movimiento de origen.");
        return;
      }
      // Solo orígenes visibles y aún no corregidos en esta página.
      if (!candidatos.some((m) => m.id === movimientoOrigenId)) {
        setError(
          "El movimiento de origen no es seleccionable en esta página (otro filtro/página, o ya tiene corrección visible). Vuelve a seleccionarlo.",
        );
        setMovimientoOrigenId("");
        invalidateKey();
        return;
      }
      if (!isImporteCreditoValido(importe)) {
        setError("Importe inválido: positivo con máximo 2 decimales.");
        return;
      }

      const confirmado = window.confirm(
        `¿Registrar corrección compensatoria?\n\n` +
          `Efecto: ${efecto}\nImporte: ${importe.trim()}\n` +
          `Origen: ${movimientoOrigenId}\nSaldo actual: ${saldoDisponible}\n\n` +
          `El movimiento original NO se elimina ni se modifica. ` +
          `Esto no es una reversión automática exacta.`,
      );
      if (!confirmado) return;

      const fp = fingerprintOperacionCredito({
        tipo: "CORREGIR",
        vendedorId,
        importe,
        motivo,
        efecto,
        movimientoOrigenId,
      });
      const idempotencyKey = ensureKey(fp);

      const res = await fetch(
        `/api/admin/creditos/${encodeURIComponent(vendedorId)}/corregir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importe: importe.trim(),
            efecto,
            movimientoOrigenId,
            motivo: motivo.trim() || undefined,
            idempotencyKey,
          }),
        },
      );
      let data: ApiErrorBody;
      try {
        data = (await res.json()) as ApiErrorBody;
      } catch {
        setError(
          "Respuesta inválida del servidor. Si reintentas la misma operación se reutilizará la clave de idempotencia.",
        );
        return;
      }
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
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo registrar la corrección.");
        return;
      }
      invalidateKey();
      setImporte("");
      setMotivo("");
      setMovimientoOrigenId("");
      setOk("Corrección registrada.");
      onSuccess();
    } catch {
      setError(
        "Error de red. Si reintentas la misma operación se reutilizará la clave de idempotencia.",
      );
    } finally {
      guardRef.current.release();
      setBusy(false);
    }
  }

  return (
    <Card padding="sm">
      <form onSubmit={(e) => void onSubmit(e)}>
        <h3 className="text-base font-bold text-ink">
          Corrección compensatoria
        </h3>
        <div className="mt-2">
          <Alert variant="warning" title="No es una reversión exacta">
            Ajusta el saldo vinculando un movimiento de origen. El historial
            original permanece intacto. Solo se permite una corrección por
            movimiento origen. La lista de origenes se limita a los movimientos
            de la página actual del historial.
          </Alert>
        </div>

        <div className="mt-3">
          <Select
            name="movimientoOrigenId"
            label="Movimiento de origen"
            value={movimientoOrigenId}
            disabled={busy}
            onChange={(e) => {
              setMovimientoOrigenId(e.target.value);
              invalidateKey();
            }}
          >
            <option value="">Seleccionar…</option>
            {candidatos.map((m) => (
              <option key={m.id} value={m.id}>
                {formatearInstanteVe(m.createdAt)} ·{" "}
                {tipoMovimientoLabel(m.tipo)} · {m.importe}
              </option>
            ))}
          </Select>
          {candidatos.length === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              No hay orígenes seleccionables en esta página. Cambia de página o
              filtro; el origen debe estar en la página actual del historial.
            </p>
          ) : null}
        </div>

        {origen ? (
          <p className="mt-2 text-xs text-ink-secondary">
            Origen: {tipoMovimientoLabel(origen.tipo)} {origen.importe} (
            {origen.saldoAnterior} → {origen.saldoPosterior})
            {origen.motivo ? ` — ${origen.motivo}` : ""}
          </p>
        ) : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input
            name="importeCorreccion"
            label="Importe del ajuste"
            type="text"
            inputMode="decimal"
            required
            value={importe}
            disabled={busy}
            onChange={(e) => {
              setImporte(e.target.value);
              invalidateKey();
            }}
            className="font-mono"
          />
          <Select
            name="efectoCorreccion"
            label="Efecto"
            value={efecto}
            disabled={busy}
            onChange={(e) => {
              setEfecto(e.target.value as "AUMENTAR" | "DISMINUIR");
              invalidateKey();
            }}
          >
            <option value="AUMENTAR">Aumentar saldo</option>
            <option value="DISMINUIR">Disminuir saldo</option>
          </Select>
          <Input
            name="motivoCorreccion"
            label="Motivo (opcional)"
            type="text"
            maxLength={500}
            value={motivo}
            disabled={busy}
            onChange={(e) => {
              setMotivo(e.target.value);
              invalidateKey();
            }}
          />
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
          variant="secondary"
          size="sm"
          disabled={busy}
          className="mt-3"
        >
          {busy ? "Registrando…" : "Registrar corrección"}
        </Button>
      </form>
    </Card>
  );
}
