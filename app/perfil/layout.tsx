import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/current-user";

/**
 * /perfil: ADMIN o VENDEDOR autenticados.
 */
export default async function PerfilLayout({
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
