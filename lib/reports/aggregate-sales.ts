import { Prisma } from "@prisma/client";
import { HORAS_SORTEO, formatearHoraSorteo } from "@/lib/fecha";
import { ordenCatalogoAnimal } from "@/lib/tickets/aggregate-exposure";
import { moneyToFixed2 } from "@/lib/tickets/ticket-liquidation";
import type {
  ReportAnimalRow,
  ReportHourRow,
  ReportVendorRow,
} from "@/lib/reports/report-types";

export type VendorAggInput = {
  vendedorId: string | null;
  nombre: string | null;
  usuario: string | null;
  totalApostado: Prisma.Decimal | string;
};

export type LineaAggInput = {
  hora: number;
  numeroAnimal: string;
  importe: Prisma.Decimal | string;
};

export type AnimalCatalogInput = {
  numero: string;
  nombre: string;
};

function toDec(value: Prisma.Decimal | string): Prisma.Decimal {
  return typeof value === "string" ? new Prisma.Decimal(value) : value;
}

/**
 * Agrupa ventas por vendedor (solo tickets EMITIDO ya filtrados).
 * vendedorId null → "Sin vendedor".
 */
export function aggregateSalesByVendor(
  rows: VendorAggInput[],
): ReportVendorRow[] {
  type Acc = {
    vendedorId: string | null;
    nombre: string;
    usuario: string | null;
    tickets: number;
    total: Prisma.Decimal;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const key = row.vendedorId ?? "__NULL__";
    const cur = map.get(key) ?? {
      vendedorId: row.vendedorId,
      nombre: row.vendedorId ? (row.nombre ?? "Vendedor") : "Sin vendedor",
      usuario: row.vendedorId ? row.usuario : null,
      tickets: 0,
      total: new Prisma.Decimal(0),
    };
    cur.tickets += 1;
    cur.total = cur.total.plus(toDec(row.totalApostado));
    map.set(key, cur);
  }

  const list = Array.from(map.values()).map((v) => ({
    vendedorId: v.vendedorId,
    nombre: v.nombre,
    usuario: v.usuario,
    tickets: v.tickets,
    totalJugado: moneyToFixed2(v.total),
  }));

  list.sort((a, b) => {
    if (a.vendedorId === null) return 1;
    if (b.vendedorId === null) return -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  return list;
}

/**
 * Ventas por hora: todas las HORAS_SORTEO en orden, incluso $0.00.
 * Solo líneas de tickets EMITIDO.
 */
export function aggregateSalesByHour(lineas: LineaAggInput[]): ReportHourRow[] {
  const totals = new Map<number, Prisma.Decimal>();
  for (const h of HORAS_SORTEO) {
    totals.set(h, new Prisma.Decimal(0));
  }

  for (const l of lineas) {
    if (!totals.has(l.hora)) continue;
    totals.set(l.hora, totals.get(l.hora)!.plus(toDec(l.importe)));
  }

  return HORAS_SORTEO.map((hora) => ({
    hora,
    horaLabel: formatearHoraSorteo(hora),
    totalJugado: moneyToFixed2(totals.get(hora)!),
  }));
}

/**
 * Ventas por animal: catálogo completo en orden, incluso $0.00.
 * Nombre desde Animal (catálogo), no hardcodeado.
 */
export function aggregateSalesByAnimal(
  lineas: LineaAggInput[],
  catalogo: AnimalCatalogInput[],
): ReportAnimalRow[] {
  const sorted = catalogo
    .slice()
    .sort((a, b) => ordenCatalogoAnimal(a.numero) - ordenCatalogoAnimal(b.numero));

  const totals = new Map<string, Prisma.Decimal>();
  for (const a of sorted) {
    totals.set(a.numero, new Prisma.Decimal(0));
  }

  for (const l of lineas) {
    if (!totals.has(l.numeroAnimal)) continue;
    totals.set(
      l.numeroAnimal,
      totals.get(l.numeroAnimal)!.plus(toDec(l.importe)),
    );
  }

  return sorted.map((a) => ({
    numeroAnimal: a.numero,
    nombreAnimal: a.nombre,
    totalJugado: moneyToFixed2(totals.get(a.numero)!),
  }));
}

/** Suma decimal de strings money. */
export function sumMoneyStrings(values: string[]): string {
  let total = new Prisma.Decimal(0);
  for (const v of values) {
    total = total.plus(toDec(v));
  }
  return moneyToFixed2(total);
}
