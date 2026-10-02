"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
        <button
          type="button"
          disabled={busy}
          onClick={() => void desactivar()}
          className="text-sm font-semibold text-red-700 underline underline-offset-2 disabled:opacity-50"
        >
          Desactivar
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void activar()}
          className="text-sm font-semibold text-emerald-800 underline underline-offset-2 disabled:opacity-50"
        >
          Activar
        </button>
      )}
      {error ? (
        <span className="text-xs font-medium text-red-700">{error}</span>
      ) : null}
      {msg ? (
        <span className="text-xs font-medium text-emerald-800">{msg}</span>
      ) : null}
    </div>
  );
}
