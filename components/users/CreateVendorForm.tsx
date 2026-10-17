"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";

export function CreateVendorForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    setOk(null);

    try {
      const res = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, usuario, password }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (res.status === 401) {
        setError("Sesión expirada. Vuelve a iniciar sesión.");
        return;
      }
      if (res.status === 403) {
        setError("No tienes permiso.");
        return;
      }
      if (!res.ok) {
        setError(data.error?.message ?? "No se pudo crear el vendedor.");
        return;
      }

      setNombre("");
      setUsuario("");
      setPassword("");
      setOk("Vendedor creado correctamente.");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void onSubmit(e)}>
        <h2 className="text-lg font-bold text-ink">Crear vendedor</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Solo se crean cuentas con rol VENDEDOR.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input
            label="Nombre"
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={nombre}
            disabled={enviando}
            onChange={(e) => setNombre(e.target.value)}
          />
          <Input
            label="Usuario"
            type="text"
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            value={usuario}
            disabled={enviando}
            onChange={(e) => setUsuario(e.target.value)}
            className="font-mono"
          />
          <Input
            label="Contraseña inicial"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            disabled={enviando}
            onChange={(e) => setPassword(e.target.value)}
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
          size="md"
          disabled={enviando}
          className="mt-4 sm:w-auto"
          fullWidth
        >
          {enviando ? "Creando…" : "Crear vendedor"}
        </Button>
      </form>
    </Card>
  );
}
