/**
 * Mutaciones administrativas de créditos (asignar / retirar / corregir / config).
 * Actor siempre desde sesión ADMIN; nunca desde el body.
 */
import type { PrismaClient } from "@prisma/client";
import {
  actualizarCreditosConfig,
  getCreditosConfig,
} from "@/lib/creditos/config";
import { CreditoValidationError } from "@/lib/creditos/errors";
import {
  asignarCreditos,
  retirarCreditos,
  registrarCorreccionCredito,
} from "@/lib/creditos/operaciones";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import {
  parseAsignarRetirarBody,
  parseConfigPatchBody,
  parseCorregirBody,
} from "@/lib/creditos/api/parse";
import {
  serializeConfig,
  serializeCuentaBasica,
  serializeMovimiento,
} from "@/lib/creditos/api/serialize";

type Db = PrismaClient;

async function assertVendedorExiste(db: Db, vendedorId: string): Promise<string> {
  const id = vendedorId.trim();
  if (!id) {
    throw new CreditoValidationError(
      "Vendedor no encontrado.",
      "CREDITO_VENDEDOR_NO_ENCONTRADO",
    );
  }
  const user = await db.usuario.findUnique({
    where: { id },
    select: { id: true, rol: true },
  });
  if (!user || user.rol !== "VENDEDOR") {
    throw new CreditoValidationError(
      "Vendedor no encontrado.",
      "CREDITO_VENDEDOR_NO_ENCONTRADO",
    );
  }
  return user.id;
}

export async function adminAsignarCreditos(
  db: Db,
  args: { vendedorId: string; actorAdminId: string; body: unknown },
) {
  const vendedorId = await assertVendedorExiste(db, args.vendedorId);
  const parsed = parseAsignarRetirarBody(args.body);
  const store = createPrismaCreditosStore(db);
  const result = await asignarCreditos(store, {
    vendedorId,
    importe: parsed.importe,
    actorAdminId: args.actorAdminId,
    motivo: parsed.motivo,
    idempotencyKey: parsed.idempotencyKey,
  });
  const config = await getCreditosConfig(store);
  return {
    movimiento: serializeMovimiento(result.movimiento),
    cuenta: serializeCuentaBasica(result.cuenta, config.umbralSaldoBajo),
  };
}

export async function adminRetirarCreditos(
  db: Db,
  args: { vendedorId: string; actorAdminId: string; body: unknown },
) {
  const vendedorId = await assertVendedorExiste(db, args.vendedorId);
  const parsed = parseAsignarRetirarBody(args.body);
  const store = createPrismaCreditosStore(db);
  const result = await retirarCreditos(store, {
    vendedorId,
    importe: parsed.importe,
    actorAdminId: args.actorAdminId,
    motivo: parsed.motivo,
    idempotencyKey: parsed.idempotencyKey,
  });
  const config = await getCreditosConfig(store);
  return {
    movimiento: serializeMovimiento(result.movimiento),
    cuenta: serializeCuentaBasica(result.cuenta, config.umbralSaldoBajo),
  };
}

export async function adminCorregirCreditos(
  db: Db,
  args: { vendedorId: string; actorAdminId: string; body: unknown },
) {
  const vendedorId = await assertVendedorExiste(db, args.vendedorId);
  const parsed = parseCorregirBody(args.body);
  const store = createPrismaCreditosStore(db);
  const result = await registrarCorreccionCredito(store, {
    vendedorId,
    importe: parsed.importe,
    efecto: parsed.efecto,
    actorAdminId: args.actorAdminId,
    movimientoOrigenId: parsed.movimientoOrigenId,
    motivo: parsed.motivo,
    idempotencyKey: parsed.idempotencyKey,
  });
  const config = await getCreditosConfig(store);
  return {
    movimiento: serializeMovimiento(result.movimiento),
    cuenta: serializeCuentaBasica(result.cuenta, config.umbralSaldoBajo),
  };
}

export async function adminGetCreditosConfig(db: Db) {
  const store = createPrismaCreditosStore(db);
  const config = await getCreditosConfig(store);
  return { config: serializeConfig(config) };
}

/**
 * PATCH configuración. No activa el control implícitamente.
 * Activar exige inicioEn (ya guardado o en el mismo patch) — dominio.
 *
 * Precondiciones al activar (documentadas para el cliente):
 * - inicioEn no nulo (instante UTC inequívoco).
 * - Saldos iniciales preparados vía asignaciones (opcional pero recomendado).
 * - No hay deducciones retroactivas: solo tickets con createdAt ≥ inicioEn.
 */
export async function adminPatchCreditosConfig(
  db: Db,
  args: { actorAdminId: string; body: unknown },
) {
  const parsed = parseConfigPatchBody(args.body);
  const store = createPrismaCreditosStore(db);
  const config = await actualizarCreditosConfig(store, {
    controlActivo: parsed.controlActivo,
    inicioEn: parsed.inicioEn,
    umbralSaldoBajo: parsed.umbralSaldoBajo,
    updatedByAdminId: args.actorAdminId,
  });
  return { config: serializeConfig(config) };
}
