import type { Metadata } from "next";
import { Suspense } from "react";
import { CajaAdminVendedorDetalle } from "@/components/caja/CajaAdminVendedorDetalle";
import { LoadingState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Caja vendedor — Admin — Lotería La Jungla",
  description: "Detalle de Caja, comisión e historial de un vendedor.",
};

type Props = { params: { vendedorId: string } };

export default function AdminCajaVendedorPage({ params }: Props) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Detalle de Caja"
        description="Obligaciones, declaraciones, confirmaciones, aplicaciones FIFO y comisión vigente."
      />
      <Suspense
        fallback={<LoadingState label="Cargando detalle…" className="mt-6" />}
      >
        <CajaAdminVendedorDetalle vendedorId={params.vendedorId} />
      </Suspense>
    </main>
  );
}
