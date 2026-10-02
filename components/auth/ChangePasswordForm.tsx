"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña y la confirmación no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo cambiar la contraseña.");
        return;
      }

      setOkMsg(
        "Contraseña actualizada. Debes iniciar sesión nuevamente.",
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        router.replace("/login");
        router.refresh();
      }, 1200);
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="mt-6 space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-bold text-stone-900">Cambiar contraseña</h2>
      <p className="text-sm text-stone-600">
        Tras el cambio se cerrará tu sesión y deberás iniciar sesión otra vez.
      </p>

      <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
        Contraseña actual
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
        Nueva contraseña
        <input
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
        Repetir nueva contraseña
        <input
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input
          type="checkbox"
          checked={showNew}
          onChange={(e) => setShowNew(e.target.checked)}
          className="rounded border-stone-300"
        />
        Mostrar nueva contraseña
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "Cambiando contraseña…" : "Cambiar contraseña"}
      </button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p role="status" className="text-sm font-medium text-emerald-800">
          {okMsg}
        </p>
      ) : null}
    </form>
  );
}
