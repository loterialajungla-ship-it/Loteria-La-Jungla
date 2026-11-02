"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, ConfirmDialog, Input } from "@/components/ui";
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import {
  fingerprintOperacionCredito,
  nuevaIdempotencyKeyCredito,
} from "@/lib/creditos/ui/idempotency";
import { isImporteCreditoValido } from "@/lib/creditos/ui/money-input";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";
import { applyConfirmOperationFailure } from "@/lib/ui/confirm-dialog";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!isImporteCreditoValido(importe)) {
      setError("Importe inválido: positivo con máximo 2 decimales.");
      return;
    }

    setConfirmOpen(true);
  }

  function onCancelConfirm() {
    if (busy) return;
    setConfirmOpen(false);
  }

  /** Cierra el diálogo y deja el error visible fuera del overlay (U1.1). */
  function failConfirmed(message: string) {
    const next = applyConfirmOperationFailure({ errorMessage: message });
    setConfirmOpen(next.confirmOpen);
    setError(next.error);
    // busy se libera en finally; los campos del formulario se conservan.
  }

  async function ejecutarAsignacion() {
    if (!guardRef.current.tryAcquire()) return;
    setBusy(true);
    setError(null);
    setOk(null);

    try {
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
        failConfirmed(
          "Respuesta inválida del servidor. Si reintentas la misma operación se reutilizará la clave de idempotencia.",
        );
        return;
      }
      if (res.status === 401) {
        failConfirmed("Sesión expirada. Vuelve a iniciar sesión.");
        onSessionExpired?.();
        return;
      }
      if (res.status === 403) {
        failConfirmed("No tienes permiso.");
        onSessionExpired?.();
        return;
      }
      if (!res.ok) {
        failConfirmed(data.error?.message ?? "No se pudo asignar.");
        return;
      }
      invalidateKey();
      setImporte("");
      setMotivo("");
      setConfirmOpen(false);
      setOk("Créditos asignados correctamente.");
      onSuccess();
    } catch {
      failConfirmed(
        "Error de red. Si reintentas la misma operación se reutilizará la clave de idempotencia.",
      );
    } finally {
      guardRef.current.release();
      setBusy(false);
    }
  }

  return (
    <Card padding="sm">
      <form onSubmit={onSubmit}>
        <h3 className="text-base font-bold text-ink">Asignar créditos</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Suma al saldo existente. Importe como texto decimal (p. ej. 10.00).
        </p>
        <div className="mt-3 grid gap-3 [&>*]:min-w-0 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
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

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar asignación"
        description={`¿Asignar ${importe.trim()} créditos a ${nombreVendedor}?\n\nEsta operación queda registrada en el libro de movimientos.`}
        confirmLabel="Asignar"
        cancelLabel="Cancelar"
        variant="default"
        loading={busy}
        onCancel={onCancelConfirm}
        onConfirm={() => void ejecutarAsignacion()}
      />
    </Card>
  );
}
