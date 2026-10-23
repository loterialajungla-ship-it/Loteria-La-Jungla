import { postAdminResultados } from "@/lib/resultados/post-admin-resultados";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return postAdminResultados(request);
}
