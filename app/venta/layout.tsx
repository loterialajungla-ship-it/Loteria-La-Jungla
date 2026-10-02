import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/current-user";

/**
 * /venta: solo ADMIN o VENDEDOR con UsuarioSesion (lj_session).
 */
export default async function VentaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getAuthContext();

  if (user?.rol === "ADMIN" || user?.rol === "VENDEDOR") {
    return <>{children}</>;
  }

  redirect("/login");
}
