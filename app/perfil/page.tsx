import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

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

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Mi cuenta"
        description="Datos de tu sesión y cambio de contraseña."
      />

      <Card className="mt-6">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-ink-muted">Nombre</dt>
            <dd className="mt-0.5 font-semibold text-ink">{user.nombre}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Usuario</dt>
            <dd className="mt-0.5 font-mono font-semibold text-ink">
              {user.usuario}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Rol</dt>
            <dd className="mt-1">
              <StatusBadge tone="info" label={user.rol} />
            </dd>
          </div>
        </dl>
      </Card>

      <ChangePasswordForm />
    </main>
  );
}
