import { formatCajaMoney } from "@/lib/caja/ui/format";
import type { CajaTotalesDto } from "@/lib/caja/ui/api-types";
import { Card } from "@/components/ui";
import { cn } from "@/components/ui/cn";

type Item = {
  key: keyof CajaTotalesDto;
  label: string;
  hint?: string;
  emphasize?: boolean;
};

const DEFAULT_ITEMS: Item[] = [
  { key: "totalBruto", label: "Bruto vendido" },
  { key: "totalComision", label: "Comisión vendedores" },
  { key: "totalObligado", label: "Obligado a entregar", emphasize: true },
  { key: "totalDeclarado", label: "Declarado" },
  { key: "totalConfirmado", label: "Confirmado (recibido)", emphasize: true },
  {
    key: "deudaPendienteEntregar",
    label: "Deuda pendiente entregar",
    hint: "Obligado − confirmado",
    emphasize: true,
  },
  {
    key: "pendienteConfirmar",
    label: "Pendiente de confirmar",
    hint: "Declarado − confirmado",
  },
  {
    key: "pendienteDeclarar",
    label: "Pendiente de declarar",
    hint: "Obligado − declarado",
  },
  {
    key: "pendienteAplicar",
    label: "Pendiente de aplicar (FIFO)",
    hint: "Confirmado − aplicado",
  },
];

export function CajaTotalesGrid({
  totales,
  items = DEFAULT_ITEMS,
  className,
}: {
  totales: CajaTotalesDto;
  items?: Item[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((it) => (
        <Card
          key={it.key}
          padding="sm"
          className={cn(it.emphasize && "border-border-strong bg-surface-muted")}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {it.label}
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-ink sm:text-xl">
            {formatCajaMoney(totales[it.key])}
          </p>
          {it.hint ? (
            <p className="mt-0.5 text-[11px] text-ink-muted">{it.hint}</p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
