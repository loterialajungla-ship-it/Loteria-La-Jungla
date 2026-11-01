"use client";

import { useRouter } from "next/navigation";
import {
  DataTableTh,
  SortableDataTableTh,
} from "@/components/ui/DataTable";
import { buildQuery } from "@/lib/ui/build-query";
import { cycleTableSort, type TableSortState } from "@/lib/ui/table-sort";
import type { AdminTicketSortKey } from "@/lib/tickets/admin-ticket-sort";

export type AdminTicketsListParams = {
  fecha?: string;
  estado?: string;
  numero?: string;
  pageSize?: string;
  sort?: string;
  dir?: string;
};

type HeadProps = {
  sort: TableSortState<AdminTicketSortKey>;
  listParams: AdminTicketsListParams;
};

function hrefForSort(
  listParams: AdminTicketsListParams,
  next: TableSortState<AdminTicketSortKey>,
): string {
  return `/admin/tickets${buildQuery({
    fecha: listParams.fecha,
    estado: listParams.estado,
    numero: listParams.numero,
    pageSize: listParams.pageSize,
    page: "1",
    sort: next.key ?? undefined,
    dir: next.dir ?? undefined,
  })}`;
}

/**
 * Cabeceras ordenables (escritorio). Navega por URL; no ordena en cliente.
 */
export function AdminTicketsSortableHead({ sort, listParams }: HeadProps) {
  const router = useRouter();

  const onSortClick = (column: AdminTicketSortKey) => {
    const next = cycleTableSort(sort, column);
    router.push(hrefForSort(listParams, next));
  };

  return (
    <tr>
      <SortableDataTableTh
        column="numeroVisible"
        sort={sort}
        onSortClick={onSortClick}
      >
        Número
      </SortableDataTableTh>
      <SortableDataTableTh
        column="fechaJuego"
        sort={sort}
        onSortClick={onSortClick}
      >
        Fecha
      </SortableDataTableTh>
      <SortableDataTableTh
        column="createdAt"
        sort={sort}
        onSortClick={onSortClick}
      >
        Creación
      </SortableDataTableTh>
      <SortableDataTableTh
        column="totalApostado"
        sort={sort}
        onSortClick={onSortClick}
      >
        Total
      </SortableDataTableTh>
      <SortableDataTableTh
        column="estado"
        sort={sort}
        onSortClick={onSortClick}
      >
        Estado
      </SortableDataTableTh>
      <DataTableTh>Resultado</DataTableTh>
      <DataTableTh>Acción</DataTableTh>
    </tr>
  );
}
