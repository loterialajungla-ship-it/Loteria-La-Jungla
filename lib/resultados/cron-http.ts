import type { AutoPublishRunResult } from "@/lib/resultados/auto-publish";

export type AutoPublishHttpStatus = 200 | 500;

/**
 * 200 solo si la corrida no tuvo franjas fallidas.
 * `ok` del cuerpo ya es falso cuando `failed > 0`.
 */
export function statusForAutomaticPublish(result: {
  ok: boolean;
  failed: number;
}): AutoPublishHttpStatus {
  if (!result.ok || result.failed > 0) return 500;
  return 200;
}

export function unauthorizedCronBody() {
  return {
    ok: false as const,
    error: { code: "UNAUTHORIZED" as const, message: "No autorizado" },
  };
}

export function autoPublishFailedBody() {
  return {
    ok: false as const,
    error: {
      code: "AUTO_PUBLISH_FAILED" as const,
      message: "No se pudieron publicar resultados automáticos.",
    },
  };
}

export async function handleAutomaticResultsRequest(
  request: Request,
  deps: {
    authorize: (request: Request) => boolean;
    publish: () => Promise<AutoPublishRunResult>;
  },
): Promise<Response> {
  if (!deps.authorize(request)) {
    return Response.json(unauthorizedCronBody(), { status: 401 });
  }

  try {
    const result = await deps.publish();
    const status = statusForAutomaticPublish(result);
    console.info(
      JSON.stringify({
        channel: "cron.resultados",
        event: "http",
        status,
        ok: result.ok,
        failed: result.failed,
        slotsAttempted: result.slotsAttempted,
        durationTotalMs: result.durationTotalMs,
      }),
    );
    return Response.json(result, { status });
  } catch {
    // Sin message interno (puede filtrar detalle de catálogo/SQL).
    console.error(
      JSON.stringify({
        channel: "cron.resultados",
        event: "http",
        status: 500,
        ok: false,
        code: "AUTO_PUBLISH_FAILED",
      }),
    );
    return Response.json(autoPublishFailedBody(), { status: 500 });
  }
}
