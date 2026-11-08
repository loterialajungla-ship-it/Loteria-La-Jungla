import { authorizeCronRequest } from "@/lib/resultados/cron-auth";
import { runAutomaticResultsPublish } from "@/lib/resultados/auto-publish";
import { handleAutomaticResultsRequest } from "@/lib/resultados/cron-http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Evita que la invocación se cancele demasiado pronto en cold start. */
export const maxDuration = 60;

/**
 * Vercel Cron invoca GET y, si existe `CRON_SECRET` en el proyecto,
 * envía `Authorization: Bearer <CRON_SECRET>`.
 * HTTP 200 solo si ninguna franja falló. `failed > 0` responde 500
 * y conserva el detalle por franja. El catálogo inválido sigue en el catch.
 */
async function handle(request: Request) {
  return handleAutomaticResultsRequest(request, {
    authorize: authorizeCronRequest,
    publish: () => runAutomaticResultsPublish(prisma),
  });
}

/** Método que usa Vercel Cron. */
export async function GET(request: Request) {
  return handle(request);
}

/** POST para schedulers externos / probes. */
export async function POST(request: Request) {
  return handle(request);
}
