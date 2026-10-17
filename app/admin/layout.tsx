import { redirect } from "next/navigation";
import { AppShell } from "@/components/nav";
import { getAuthContext } from "@/lib/auth/current-user";

/**
 * Layout de /admin/*.
 * Solo ADMIN con UsuarioSesion; VENDEDOR → /venta; sin sesión → /login.
 * /admin/login → /login vía middleware (308).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getAuthContext();

  if (user?.rol === "VENDEDOR") {
    redirect("/venta");
  }

  if (user?.rol === "ADMIN") {
    return (
      <AppShell user={user} variant="admin">
        {children}
      </AppShell>
    );
  }

  redirect("/login");
}
