import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { getAdminResultadosAtrasados } from "@/lib/resultados/list-atrasados-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/resultados/atrasados?desde=&hasta=&page=&pageSize=
 * Solo lectura. Franjas de días anteriores (Caracas) sin Resultado.
 * No publica ni materializa programaciones.
 */
export async function GET(request: Request) {
  return getAdminResultadosAtrasados(request, {
    requireAdmin,
    db: prisma,
  });
}
