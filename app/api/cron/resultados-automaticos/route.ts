import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/resultados/cron-auth";
import { runAutomaticResultsPublish } from "@/lib/resultados/auto-publish";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Evita que la invocación se cancele demasiado pronto en cold start. */
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: { code: "UNAUTHORIZED", message: "No autorizado" } },
    { status: 401 },
  );
}

/**
 * Vercel Cron invoca GET y, si existe `CRON_SECRET` en el proyecto,
 * envía `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(request: Request) {
  if (!authorizeCronRequest(request)) {
    return unauthorized();
  }

  try {
    const result = await runAutomaticResultsPublish(prisma);
    // 200 aunque haya fallos parciales: el cuerpo indica `ok`/`failed`.
    // 500 solo si la corrida no pudo arrancar (p. ej. catálogo vacío).
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron/resultados-automaticos]", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTO_PUBLISH_FAILED",
          message: "No se pudieron publicar resultados automáticos.",
        },
      },
      { status: 500 },
    );
  }
}

/** Método que usa Vercel Cron. */
export async function GET(request: Request) {
  return handle(request);
}

/** POST para schedulers externos / probes. */
export async function POST(request: Request) {
  return handle(request);
}
