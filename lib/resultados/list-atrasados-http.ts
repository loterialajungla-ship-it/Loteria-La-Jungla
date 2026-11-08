import { NextResponse } from "next/server";
import type { AdminActor } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { UserValidationError } from "@/lib/auth/errors";
import {
  listSorteosAtrasados,
  type ListAtrasadosQuery,
  type ListAtrasadosResult,
} from "@/lib/resultados/list-atrasados";

export type ListAtrasadosHttpDeps = {
  requireAdmin: () => Promise<AdminActor>;
  list: (
    query: ListAtrasadosQuery,
  ) => Promise<ListAtrasadosResult>;
};

/**
 * GET admin de sorteos atrasados. Solo lectura.
 * Auth fail → 401/403. Query inválida → 400.
 */
export async function handleListAtrasadosRequest(
  request: Request,
  deps: ListAtrasadosHttpDeps,
): Promise<NextResponse> {
  try {
    await deps.requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await deps.list({
      desde: searchParams.get("desde"),
      hasta: searchParams.get("hasta"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof UserValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: error.code, message: error.message },
        },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    console.error("[api/admin/resultados/atrasados]", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "No se pudieron consultar los sorteos atrasados.",
        },
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

/** Cableado de producción: requireAdmin + listSorteosAtrasados(prisma). */
export async function getAdminResultadosAtrasados(
  request: Request,
  deps: {
    requireAdmin: () => Promise<AdminActor>;
    db: Parameters<typeof listSorteosAtrasados>[0];
    ahora?: Date;
  },
): Promise<NextResponse> {
  return handleListAtrasadosRequest(request, {
    requireAdmin: deps.requireAdmin,
    list: (query) =>
      listSorteosAtrasados(deps.db, query, deps.ahora ?? new Date()),
  });
}
