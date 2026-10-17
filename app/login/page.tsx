import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { getAuthContext } from "@/lib/auth/current-user";
import { redirectPathForRole } from "@/lib/auth/login";
import { Alert, Button, Card, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Entrar — Lotería La Jungla",
  description: "Acceso al panel y punto de venta.",
};

type Props = {
  searchParams: { error?: string };
};

/**
 * Login oficial único: /login
 * ADMIN → /admin · VENDEDOR → /venta
 */
export default async function LoginPage({ searchParams }: Props) {
  const { user } = await getAuthContext();
  if (user) {
    redirect(redirectPathForRole(user.rol));
  }

  const error = searchParams.error === "1";

  return (
    <div className="relative min-h-screen bg-background text-ink">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-brand-50 to-transparent"
        aria-hidden
      />
      <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="hero" priority className="drop-shadow-sm" />
        </div>
        <PageHeader
          brand=""
          title="Iniciar sesión"
          description="Acceso para administradores y vendedores."
          className="items-center text-center sm:flex-col sm:items-center"
        />

        <Card className="mt-8" padding="lg">
          <form
            action="/api/admin/login"
            method="post"
            className="flex flex-col gap-4"
          >
            <Input
              type="text"
              name="usuario"
              label="Usuario"
              required
              autoComplete="username"
            />

            <Input
              type="password"
              name="password"
              label="Contraseña"
              required
              minLength={8}
              autoComplete="current-password"
            />

            {error ? (
              <Alert variant="error" title="No se pudo iniciar sesión">
                Usuario o contraseña incorrectos.
              </Alert>
            ) : null}

            <Button type="submit" variant="primary" size="lg" fullWidth>
              Entrar
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-sm text-ink-muted">
          <Link
            href="/"
            className="underline underline-offset-2 hover:text-ink focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            Volver a resultados públicos
          </Link>
        </p>
      </main>
    </div>
  );
}
