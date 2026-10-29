"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";
import type { ApiErrorBody } from "@/lib/creditos/ui/api-types";
import {
  fingerprintOperacionCredito,
  nuevaIdempotencyKeyCredito,
} from "@/lib/creditos/ui/idempotency";
import {
  importeMayorQue,
  isImporteCreditoValido,
} from "@/lib/creditos/ui/money-input";
import { createSubmitGuard } from "@/lib/creditos/ui/submit-guard";

type Props = {
  vendedorId: string;
  nombreVendedor: string;
  saldoDisponible: string;
  onSuccess: () => void;
  onSessionExpired?: () => void;
};

export function RetirarCreditosForm({
  vendedorId,
  nombreVendedor,
  saldoDisponible,
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

      const supera = importeMayorQue(importe, saldoDisponible);
      let msg =
        `¿Retirar ${importe.trim()} créditos de ${nombreVendedor}?\n\n` +
        `Saldo actual: ${saldoDisponible}`;
      if (supera) {
        msg +=
          "\n\nADVERTENCIA: el importe supera el saldo mostrado. El servidor rechazará si no hay saldo suficiente.";
      }
      if (!window.confirm(msg)) return;

      const fp = fingerprintOperacionCredito({
        tipo: "RETIRAR",
        vendedorId,
        importe,
        motivo,
      });
      const idempotencyKey = ensureKey(fp);

      const res = await fetch(
        `/api/admin/creditos/${encodeURIComponent(vendedorId)}/retirar`,
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
        const code = data.error?.code;
        if (code === "INSUFFICIENT_CREDITO_SALDO") {
          setError(
            data.error?.message ??
              "Saldo insuficiente. El backend rechazó el retiro.",
          );
        } else {
          setError(data.error?.message ?? "No se pudo retirar.");
        }
        return;
      }
      invalidateKey();
      setImporte("");
      setMotivo("");
      setOk("Retiro registrado correctamente.");
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
        <h3 className="text-base font-bold text-ink">Retirar créditos</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Saldo actual:{" "}
          <strong className="font-mono text-ink">{saldoDisponible}</strong>
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            name="importeRetirar"
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
            name="motivoRetirar"
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
        {importe &&
        isImporteCreditoValido(importe) &&
        importeMayorQue(importe, saldoDisponible) ? (
          <div className="mt-3">
            <Alert variant="warning" title="Saldo insuficiente (vista previa)">
              El importe supera el saldo mostrado. El servidor es la autoridad
              final.
            </Alert>
          </div>
        ) : null}
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
          variant="danger"
          size="sm"
          disabled={busy}
          className="mt-3"
        >
          {busy ? "Retirando…" : "Retirar"}
        </Button>
      </form>
    </Card>
  );
}
