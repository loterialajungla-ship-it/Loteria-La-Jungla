/**
 * Lista blanca y mapa tipado de orderBy para listado admin de tickets.
 * Sin SQL dinámico. No incluye estadoDerivado (derivado post-consulta).
 */

import type { Prisma } from "@prisma/client";
import { resolveOrderByFromMap } from "@/lib/ui/table-sort-query";
import type { TableSortDir, TableSortState } from "@/lib/ui/table-sort";

export const ADMIN_TICKET_SORT_KEYS = [
  "numeroVisible",
  "fechaJuego",
  "createdAt",
  "totalApostado",
  "estado",
] as const;

export type AdminTicketSortKey = (typeof ADMIN_TICKET_SORT_KEYS)[number];

export type AdminTicketOrderBy = Prisma.TicketOrderByWithRelationInput[];

const TIE_BREAK: Prisma.TicketOrderByWithRelationInput = { id: "desc" };

export const ADMIN_TICKET_ORDER_BY_DEFAULT: AdminTicketOrderBy = [
  { createdAt: "desc" },
  TIE_BREAK,
];

function withTieBreak(
  primary: Prisma.TicketOrderByWithRelationInput,
): AdminTicketOrderBy {
  return [primary, TIE_BREAK];
}

const ORDER_BY_BUILDERS: Readonly<
  Record<AdminTicketSortKey, (dir: TableSortDir) => AdminTicketOrderBy>
> = {
  numeroVisible: (dir) => withTieBreak({ numeroVisible: dir }),
  fechaJuego: (dir) => withTieBreak({ fechaJuego: dir }),
  createdAt: (dir) => withTieBreak({ createdAt: dir }),
  totalApostado: (dir) => withTieBreak({ totalApostado: dir }),
  estado: (dir) => withTieBreak({ estado: dir }),
};

/** Construye orderBy Prisma a partir del estado parseado (whitelist + fallback). */
export function buildAdminTicketOrderBy(
  state: TableSortState<AdminTicketSortKey>,
): AdminTicketOrderBy {
  return resolveOrderByFromMap(
    state,
    ORDER_BY_BUILDERS,
    ADMIN_TICKET_ORDER_BY_DEFAULT,
  );
}
