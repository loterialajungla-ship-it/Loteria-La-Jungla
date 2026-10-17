import { redirect } from "next/navigation";
import { AppShell } from "@/components/nav";
import { getAuthContext } from "@/lib/auth/current-user";

/**
 * /venta: solo ADMIN o VENDEDOR con UsuarioSesion (lj_session).
 * ADMIN ve shell admin; VENDEDOR ve shell de venta.
 */
export default async function VentaLayout({
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
