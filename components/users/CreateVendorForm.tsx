"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-lg font-bold text-stone-900">Crear vendedor</h2>
      <p className="mt-1 text-sm text-stone-600">
        Solo se crean cuentas con rol VENDEDOR.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Nombre
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={nombre}
            disabled={enviando}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Usuario
          <input
            type="text"
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            value={usuario}
            disabled={enviando}
            onChange={(e) => setUsuario(e.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2.5 font-mono text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Contraseña inicial
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            disabled={enviando}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-800">
          {ok}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="mt-4 w-full rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
      >
        {enviando ? "Creando…" : "Crear vendedor"}
      </button>
    </form>
  );
}
