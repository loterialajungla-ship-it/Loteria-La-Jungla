import type { Metadata } from "next";
import { Suspense } from "react";
import { CreditoDetallePanel } from "@/components/creditos/CreditoDetallePanel";
import { LoadingState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Detalle créditos — Admin — Lotería La Jungla",
  description: "Detalle de cuenta y movimientos de un vendedor.",
};

type Props = { params: { vendedorId: string } };

export default function AdminCreditoDetallePage({ params }: Props) {
  const vendedorId = params.vendedorId?.trim() ?? "";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Cuenta de créditos"
        description="Saldo, operaciones e historial del vendedor seleccionado."
      />
      <Suspense
        fallback={<LoadingState label="Cargando cuenta…" className="mt-6" />}
      >
        <CreditoDetallePanel vendedorId={vendedorId} />
      </Suspense>
    </main>
  );
}
