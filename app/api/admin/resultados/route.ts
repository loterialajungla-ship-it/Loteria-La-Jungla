import { rejectCrossOriginMutation } from "@/lib/http/csrf";
import { postAdminResultados } from "@/lib/resultados/post-admin-resultados";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrfBlock = rejectCrossOriginMutation(request);
  if (csrfBlock) return csrfBlock;
  return postAdminResultados(request);
}
