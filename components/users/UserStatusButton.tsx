"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

type Props = {
  userId: string;
  nombre: string;
  activo: boolean;
};

export function UserStatusButton({ userId, nombre, activo }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function activar() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${userId}/activar`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo activar.");
        return;
      }
      setMsg("Vendedor activado.");
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setBusy(false);
    }
  }

  async function desactivar() {
    if (busy) return;
    const ok = window.confirm(
      `¿Desactivar a ${nombre}?\n\nEl vendedor ya no podrá iniciar sesión ni crear nuevos tickets.\nEl histórico de sus tickets permanecerá intacto.`,
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${userId}/desactivar`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo desactivar.");
        return;
      }
      setMsg("Vendedor desactivado.");
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {activo ? (
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => void desactivar()}
        >
          {busy ? "Procesando…" : "Desactivar"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void activar()}
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
    </div>
  );
}
