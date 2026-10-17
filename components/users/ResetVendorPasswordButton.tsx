"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Input } from "@/components/ui";

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
    if (busy) return;
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
      setMsg(
        "Contraseña restablecida. El vendedor debe iniciar sesión de nuevo.",
      );
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setMsg(null);
        }}
      >
        {open ? "Cancelar" : "Restablecer contraseña"}
      </Button>

      {open ? (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="mt-2 w-64 space-y-2 rounded-lj-md border border-border bg-surface-muted p-3 text-left"
        >
          <p className="text-xs text-ink-secondary">
            Restablecer contraseña de <strong className="text-ink">{nombre}</strong>{" "}
            (<span className="font-mono">({usuario})</span>.
          </p>
          <Alert variant="warning" title="Atención">
            El vendedor deberá iniciar sesión nuevamente después de restablecer
            su contraseña.
          </Alert>
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
            label="Repetir contraseña"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            disabled={busy}
          />
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={showNew}
              onChange={(e) => setShowNew(e.target.checked)}
            />
            Mostrar
          </label>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy}
          >
            {busy ? "Restableciendo…" : "Restablecer contraseña"}
          </Button>
        </form>
      ) : null}

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
