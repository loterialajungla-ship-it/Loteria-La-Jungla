"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  userId: string;
  nombre: string;
  usuario: string;
};

export function ResetVendorPasswordButton({ userId, nombre, usuario }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);

    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña y la confirmación no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/usuarios/${encodeURIComponent(userId)}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo restablecer.");
        return;
      }
      setMsg("Contraseña restablecida. El vendedor debe iniciar sesión de nuevo.");
      setNewPassword("");
      setConfirmPassword("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setMsg(null);
        }}
        className="text-sm font-semibold text-stone-800 underline underline-offset-2 disabled:opacity-50"
      >
        {open ? "Cancelar" : "Restablecer contraseña"}
      </button>

      {open ? (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="mt-2 w-64 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-left"
        >
          <p className="text-xs text-stone-600">
            Restablecer contraseña de <strong>{nombre}</strong> (
            <span className="font-mono">{usuario}</span>).
          </p>
          <p className="text-xs font-medium text-amber-900">
            El vendedor deberá iniciar sesión nuevamente después de restablecer
            su contraseña.
          </p>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-700">
            Nueva contraseña
            <input
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-700">
            Repetir contraseña
            <input
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={showNew}
              onChange={(e) => setShowNew(e.target.checked)}
            />
            Mostrar
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-stone-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Restableciendo…" : "Restablecer contraseña"}
          </button>
        </form>
      ) : null}

      {error ? (
        <span className="text-xs font-medium text-red-700">{error}</span>
      ) : null}
      {msg ? (
        <span className="text-xs font-medium text-emerald-800">{msg}</span>
      ) : null}
    </div>
  );
}
