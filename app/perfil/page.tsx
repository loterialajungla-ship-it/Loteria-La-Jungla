import type { Metadata } from "next";
import Link from "next/link";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi cuenta — Lotería La Jungla",
  description: "Perfil y cambio de contraseña.",
};

export default async function PerfilPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const homeHref = user.rol === "VENDEDOR" ? "/venta" : "/admin";

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Mi cuenta</h1>
          </div>
          <Link
            href={homeHref}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            Volver
          </Link>
        </div>

        <dl className="mt-6 space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm text-sm">
          <div>
            <dt className="text-stone-500">Nombre</dt>
            <dd className="mt-0.5 font-semibold text-stone-900">{user.nombre}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Usuario</dt>
            <dd className="mt-0.5 font-mono font-semibold text-stone-900">
              {user.usuario}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Rol</dt>
            <dd className="mt-0.5 font-semibold text-stone-900">{user.rol}</dd>
          </div>
        </dl>

        <ChangePasswordForm />
      </main>
    </div>
  );
}
