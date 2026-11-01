/**
 * Lista blanca y mapa tipado de orderBy para listado /venta/tickets.
 * Sin SQL dinámico. Ordena por estado persistido (EMITIDO|ANULADO),
 * no por estadoDerivado (post-consulta).
 *
 * Campos ordenables son NOT NULL en Ticket → sin estrategia especial de nulos;
 * desempate estable siempre por id DESC.
 */

import type { Prisma } from "@prisma/client";
import { resolveOrderByFromMap } from "@/lib/ui/table-sort-query";
import type { TableSortDir, TableSortState } from "@/lib/ui/table-sort";

export const VENDOR_TICKET_SORT_KEYS = [
  "numeroVisible",
  "fechaJuego",
  "createdAt",
  "totalApostado",
  "estado",
] as const;

export type VendorTicketSortKey = (typeof VENDOR_TICKET_SORT_KEYS)[number];

export type VendorTicketOrderBy = Prisma.TicketOrderByWithRelationInput[];

const TIE_BREAK: Prisma.TicketOrderByWithRelationInput = { id: "desc" };

export const VENDOR_TICKET_ORDER_BY_DEFAULT: VendorTicketOrderBy = [
  { createdAt: "desc" },
  TIE_BREAK,
];

function withTieBreak(
  primary: Prisma.TicketOrderByWithRelationInput,
): VendorTicketOrderBy {
  return [primary, TIE_BREAK];
}

const ORDER_BY_BUILDERS: Readonly<
  Record<VendorTicketSortKey, (dir: TableSortDir) => VendorTicketOrderBy>
> = {
  numeroVisible: (dir) => withTieBreak({ numeroVisible: dir }),
  fechaJuego: (dir) => withTieBreak({ fechaJuego: dir }),
  createdAt: (dir) => withTieBreak({ createdAt: dir }),
  totalApostado: (dir) => withTieBreak({ totalApostado: dir }),
  estado: (dir) => withTieBreak({ estado: dir }),
};

/** Construye orderBy Prisma a partir del estado parseado (whitelist + fallback). */
export function buildVendorTicketOrderBy(
  state: TableSortState<VendorTicketSortKey>,
): VendorTicketOrderBy {
  return resolveOrderByFromMap(
    state,
    ORDER_BY_BUILDERS,
    VENDOR_TICKET_ORDER_BY_DEFAULT,
  );
}
