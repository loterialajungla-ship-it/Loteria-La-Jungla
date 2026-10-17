"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";

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
    if (busy) return;
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
    <Card className="mt-6">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <h2 className="text-lg font-bold text-ink">Cambiar contraseña</h2>
        <p className="text-sm text-ink-muted">
          Tras el cambio se cerrará tu sesión y deberás iniciar sesión otra vez.
        </p>

        <Input
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          disabled={busy}
        />

        <Input
          label="Nueva contraseña"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          disabled={busy}
        />

        <Input
          label="Repetir nueva contraseña"
          type={showNew ? "text" : "password"}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          disabled={busy}
        />

        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={showNew}
            onChange={(e) => setShowNew(e.target.checked)}
            className="rounded border-border-strong"
          />
          Mostrar nueva contraseña
        </label>

        <Button
          type="submit"
          variant="primary"
          size="md"
          fullWidth
          disabled={busy}
        >
          {busy ? "Cambiando contraseña…" : "Cambiar contraseña"}
        </Button>

        {error ? (
          <Alert variant="error" title="Error">
            {error}
          </Alert>
        ) : null}
        {okMsg ? (
          <Alert variant="success" title="Correcto">
            {okMsg}
          </Alert>
        ) : null}
      </form>
    </Card>
  );
}
