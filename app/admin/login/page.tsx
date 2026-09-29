import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Entrar — Lotería La Jungla",
  description: "Acceso al panel de administración.",
};

type Props = {
  searchParams: { error?: string };
};

export default function AdminLoginPage({ searchParams }: Props) {
  const error = searchParams.error === "1";

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Lotería La Jungla
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Panel admin</h1>
        <p className="mt-2 text-stone-600">Ingresa la contraseña para cargar resultados.</p>

        <form
          action="/api/admin/login"
          method="post"
          className="mt-8 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Contraseña
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="rounded-xl border border-stone-300 px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Contraseña incorrecta.
            </p>
          ) : null}

          <button
            type="submit"
            className="rounded-xl bg-emerald-800 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700"
          >
            Entrar
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-500">
          <Link href="/" className="underline underline-offset-2 hover:text-stone-800">
            Volver a resultados
          </Link>
        </p>
      </main>
    </div>
  );
}
