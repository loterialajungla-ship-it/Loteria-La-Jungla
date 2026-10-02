import { permanentRedirect } from "next/navigation";

type Props = {
  searchParams: { error?: string };
};

/**
 * Compatibilidad: /admin/login → /login (único formulario).
 * permanentRedirect = 308 en App Router.
 */
export default function AdminLoginCompatRedirect({ searchParams }: Props) {
  const q = searchParams.error === "1" ? "?error=1" : "";
  permanentRedirect(`/login${q}`);
}
