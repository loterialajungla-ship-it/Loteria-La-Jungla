import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { jsonAuthError } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import {
  createVendor,
  listAdminUsers,
} from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/usuarios?activo=&rol=&page=&pageSize=
 * Solo ADMIN. Sin passwordHash.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await listAdminUsers(prisma, {
      activo: searchParams.get("activo"),
      rol: searchParams.get("rol"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/usuarios
 * Crea únicamente VENDEDOR. Ignora/rechaza rol ADMIN.
 */
export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return jsonAuthError(error);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_JSON", message: "JSON inválido." },
      },
      { status: 400 },
    );
  }

  try {
    const user = await createVendor(prisma, raw, {
      actorUserId: admin.userId,
    });
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return jsonAuthError(error);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      },
      { status: 500 },
    );
  }
}
