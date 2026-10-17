import { redirect } from "next/navigation";
import { AppShell } from "@/components/nav";
import { getAuthContext } from "@/lib/auth/current-user";

/**
 * /perfil: ADMIN o VENDEDOR autenticados.
 * Variante de navegación según el rol de la sesión ya resuelta.
 */
export default async function PerfilLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getAuthContext();

  if (user?.rol === "ADMIN") {
    return (
      <AppShell user={user} variant="admin">
        {children}
      </AppShell>
    );
  }

  if (user?.rol === "VENDEDOR") {
    return (
      <AppShell user={user} variant="vendor">
        {children}
      </AppShell>
    );
  }

  redirect("/login");
}
