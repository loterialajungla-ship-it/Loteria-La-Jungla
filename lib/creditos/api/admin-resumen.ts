/**
 * Resumen administrativo de créditos por vendedor.
 *
 * Semántica de totales (SUM del tipo; no mezclar devoluciones/correcciones
 * dentro de asignado/retirado/consumido):
 * - totalAsignado = Σ ASIGNACION.importe
 * - totalRetirado = Σ RETIRO.importe
 * - totalConsumidoVentas = Σ CONSUMO_VENTA.importe
 * - totalDevueltoAnulaciones = Σ DEVOLUCION_ANULACION.importe
 * - totalCorreccionesAumento / Disminucion = Σ CORRECCION según signo
 *
 * saldoDisponible: proyección de cuenta; "0.00" si no hay cuenta (tieneCuenta=false).
 * Sin inventar movimientos.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { getCreditosConfig } from "@/lib/creditos/config";
import { CreditoValidationError } from "@/lib/creditos/errors";
import { moneyFixed2 } from "@/lib/creditos/money";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import { parseResumenQuery } from "@/lib/creditos/api/parse";
import { serializeConfig } from "@/lib/creditos/api/serialize";

type Db = Pick<
  PrismaClient,
  | "usuario"
  | "vendedorCreditoCuenta"
  | "creditoMovimiento"
  | "creditosConfig"
  | "$queryRaw"
>;

export type CreditoResumenItem = {
  vendedorId: string;
  usuario: string;
  nombre: string;
  activo: boolean;
  tieneCuenta: boolean;
  saldoDisponible: string;
  totalAsignado: string;
  totalRetirado: string;
  totalConsumidoVentas: string;
  totalDevueltoAnulaciones: string;
  totalCorreccionesAumento: string;
  totalCorreccionesDisminucion: string;
  ultimaActividadCreditosAt: string | null;
  saldoBajo: boolean;
};

export type CreditoResumenResult = {
  items: CreditoResumenItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  config: ReturnType<typeof serializeConfig>;
};

type TotalesRow = {
  vendedorId: string;
  totalAsignado: Prisma.Decimal | string | null;
  totalRetirado: Prisma.Decimal | string | null;
  totalConsumido: Prisma.Decimal | string | null;
  totalDevuelto: Prisma.Decimal | string | null;
  totalCorrAum: Prisma.Decimal | string | null;
  totalCorrDis: Prisma.Decimal | string | null;
  ultimaActividad: Date | null;
};

/** Agregados PG: confiar en Decimal/string del driver (no revalidar regex API). */
function dec(v: Prisma.Decimal | string | null | undefined): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v);
}

export async function listCreditosResumenAdmin(
  db: Db,
  searchParams: URLSearchParams,
): Promise<CreditoResumenResult> {
  const { activo, saldoBajo, page, pageSize } = parseResumenQuery(searchParams);
  const store = createPrismaCreditosStore(db as never);
  const config = await getCreditosConfig(store);
  const umbral = config.umbralSaldoBajo;

  if (saldoBajo !== undefined && umbral == null) {
    throw new CreditoValidationError(
      "No hay umbral de saldo bajo configurado; no se puede filtrar por saldoBajo.",
      "CREDITO_UMBRAL_NO_CONFIGURADO",
    );
  }

  const whereUsuario: Prisma.UsuarioWhereInput = {
    rol: "VENDEDOR",
    ...(activo === undefined ? {} : { activo }),
  };

  // Candidatos (ids) respetando activo; luego filtro saldoBajo y paginación.
  const candidatos = await db.usuario.findMany({
    where: whereUsuario,
    orderBy: [{ usuario: "asc" }],
    select: {
      id: true,
      usuario: true,
      nombre: true,
      activo: true,
    },
  });

  const cuentas = await db.vendedorCreditoCuenta.findMany({
    where: { vendedorId: { in: candidatos.map((c) => c.id) } },
  });
  const cuentaById = new Map(cuentas.map((c) => [c.vendedorId, c]));

  let filtrados = candidatos.map((v) => {
    const cuenta = cuentaById.get(v.id) ?? null;
    const saldo = cuenta?.saldoDisponible ?? new Prisma.Decimal(0);
    const bajo = umbral != null && cuenta != null ? saldo.lte(umbral) : false;
    return { v, cuenta, saldo, bajo };
  });

  if (saldoBajo === true) {
    filtrados = filtrados.filter((x) => x.bajo);
  } else if (saldoBajo === false) {
    filtrados = filtrados.filter((x) => !x.bajo);
  }

  const total = filtrados.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const pageRows = filtrados.slice((page - 1) * pageSize, page * pageSize);

  if (pageRows.length === 0) {
    return {
      items: [],
      page,
      pageSize,
      total,
      totalPages,
      config: serializeConfig(config),
    };
  }

  const ids = pageRows.map((r) => r.v.id);
  const totales = await db.$queryRaw<TotalesRow[]>`
    SELECT
      "vendedorId",
      COALESCE(SUM(CASE WHEN "tipo" = 'ASIGNACION' THEN "importe" ELSE 0 END), 0) AS "totalAsignado",
      COALESCE(SUM(CASE WHEN "tipo" = 'RETIRO' THEN "importe" ELSE 0 END), 0) AS "totalRetirado",
      COALESCE(SUM(CASE WHEN "tipo" = 'CONSUMO_VENTA' THEN "importe" ELSE 0 END), 0) AS "totalConsumido",
      COALESCE(SUM(CASE WHEN "tipo" = 'DEVOLUCION_ANULACION' THEN "importe" ELSE 0 END), 0) AS "totalDevuelto",
      COALESCE(SUM(CASE
        WHEN "tipo" = 'CORRECCION' AND "saldoPosterior" > "saldoAnterior" THEN "importe"
        ELSE 0 END), 0) AS "totalCorrAum",
      COALESCE(SUM(CASE
        WHEN "tipo" = 'CORRECCION' AND "saldoPosterior" < "saldoAnterior" THEN "importe"
        ELSE 0 END), 0) AS "totalCorrDis",
      MAX("createdAt") AS "ultimaActividad"
    FROM "CreditoMovimiento"
    WHERE "vendedorId" IN (${Prisma.join(ids)})
    GROUP BY "vendedorId"
  `;
  const totById = new Map(totales.map((t) => [t.vendedorId, t]));

  const items: CreditoResumenItem[] = pageRows.map(({ v, cuenta, saldo, bajo }) => {
    const tot = totById.get(v.id);
    return {
      vendedorId: v.id,
      usuario: v.usuario,
      nombre: v.nombre,
      activo: v.activo,
      tieneCuenta: cuenta != null,
      saldoDisponible: moneyFixed2(saldo),
      totalAsignado: moneyFixed2(dec(tot?.totalAsignado)),
      totalRetirado: moneyFixed2(dec(tot?.totalRetirado)),
      totalConsumidoVentas: moneyFixed2(dec(tot?.totalConsumido)),
      totalDevueltoAnulaciones: moneyFixed2(dec(tot?.totalDevuelto)),
      totalCorreccionesAumento: moneyFixed2(dec(tot?.totalCorrAum)),
      totalCorreccionesDisminucion: moneyFixed2(dec(tot?.totalCorrDis)),
      ultimaActividadCreditosAt: tot?.ultimaActividad
        ? new Date(tot.ultimaActividad).toISOString()
        : null,
      saldoBajo: bajo,
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    config: serializeConfig(config),
  };
}
