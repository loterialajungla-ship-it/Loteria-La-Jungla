"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui";
import { applyConfirmOperationFailure } from "@/lib/ui/confirm-dialog";

type Props = {
  userId: string;
  nombre: string;
  activo: boolean;
  /** Tras éxito en API (p. ej. paneles cliente que no viven solo de RSC). */
  onSuccess?: () => void;
};

type PendingAction = "activar" | "desactivar";

export function UserStatusButton({
  userId,
  nombre,
  activo,
  onSuccess,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  function pedirConfirmacion(action: PendingAction) {
    if (inFlightRef.current || busy) return;
    setError(null);
    setMsg(null);
    setPending(action);
    setConfirmOpen(true);
  }

  function onCancelConfirm() {
    if (busy) return;
    setConfirmOpen(false);
    setPending(null);
  }

  function failConfirmed(message: string) {
    const next = applyConfirmOperationFailure({ errorMessage: message });
    setConfirmOpen(next.confirmOpen);
    setPending(null);
    setError(next.error);
  }

  async function ejecutar() {
    if (!pending) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setMsg(null);

    const action = pending;
    try {
      const res = await fetch(
        `/api/admin/usuarios/${encodeURIComponent(userId)}/${action}`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        failConfirmed(
          data.error?.message ??
            (action === "activar"
              ? "No se pudo activar."
              : "No se pudo desactivar."),
        );
        return;
      }
      setMsg(
        action === "activar" ? "Vendedor activado." : "Vendedor desactivado.",
      );
      setConfirmOpen(false);
      setPending(null);
      router.refresh();
      onSuccess?.();
    } catch {
      failConfirmed("Error de red.");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  const isDesactivar = pending === "desactivar";

  return (
    <div className="flex flex-col items-end gap-1">
      {activo ? (
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => pedirConfirmacion("desactivar")}
        >
          {busy ? "Procesando…" : "Desactivar"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => pedirConfirmacion("activar")}
        >
          {busy ? "Procesando…" : "Activar"}
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </span>
      ) : null}
      {msg ? (
        <span role="status" className="text-xs font-medium text-brand-800">
          {msg}
        </span>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={isDesactivar ? "Desactivar vendedor" : "Activar vendedor"}
        description={
          isDesactivar
            ? `¿Desactivar a ${nombre}?\n\nEl vendedor ya no podrá iniciar sesión ni crear nuevos tickets.\nEl histórico de sus tickets y el saldo de créditos permanecerán intactos.`
            : `¿Activar a ${nombre}?\n\nEl vendedor podrá iniciar sesión y operar de nuevo.\nEsto no modifica su saldo ni historial de créditos.`
        }
        confirmLabel={isDesactivar ? "Desactivar" : "Activar"}
        cancelLabel="Cancelar"
        variant={isDesactivar ? "danger" : "default"}
        loading={busy}
        onCancel={onCancelConfirm}
        onConfirm={() => void ejecutar()}
      />
    </div>
  );
}
