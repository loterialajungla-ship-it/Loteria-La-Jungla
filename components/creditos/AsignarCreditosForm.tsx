"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import {
  fingerprintOperacionCredito,
  nuevaIdempotencyKeyCredito,
} from "@/lib/creditos/ui/idempotency";
import { isImporteCreditoValido } from "@/lib/creditos/ui/money-input";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";

type Props = {
  vendedorId: string;
  nombreVendedor: string;
  onSuccess: () => void;
  onSessionExpired?: () => void;
};

export function AsignarCreditosForm({
  vendedorId,
  nombreVendedor,
  onSuccess,
  onSessionExpired,
}: Props) {
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const guardRef = useRef(createSubmitGuard());

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
      if (!isImporteCreditoValido(importe)) {
        setError("Importe inválido: positivo con máximo 2 decimales.");
        return;
      }

      const confirmado = window.confirm(
        `¿Asignar ${importe.trim()} créditos a ${nombreVendedor}?\n\nEsta operación queda registrada en el libro de movimientos.`,
      );
      if (!confirmado) return;

      const fp = fingerprintOperacionCredito({
        tipo: "ASIGNAR",
        vendedorId,
        importe,
        motivo,
      });
      const idempotencyKey = ensureKey(fp);

      const res = await fetch(
        `/api/admin/creditos/${encodeURIComponent(vendedorId)}/asignar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importe: importe.trim(),
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
        setError(data.error?.message ?? "No se pudo asignar.");
        return;
      }
      invalidateKey();
      setImporte("");
      setMotivo("");
      setOk("Créditos asignados correctamente.");
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
        <h3 className="text-base font-bold text-ink">Asignar créditos</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Suma al saldo existente. Importe como texto decimal (p. ej. 10.00).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            name="importeAsignar"
            label="Importe"
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
          <Input
            name="motivoAsignar"
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
          variant="primary"
          size="sm"
          disabled={busy}
          className="mt-3"
        >
          {busy ? "Asignando…" : "Asignar"}
        </Button>
      </form>
    </Card>
  );
}
