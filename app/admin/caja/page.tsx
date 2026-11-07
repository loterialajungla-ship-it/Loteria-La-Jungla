import type { Metadata } from "next";
import { Suspense } from "react";
import { CajaAdminPanel } from "@/components/caja/CajaAdminPanel";
import { LoadingState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Caja — Admin — Lotería La Jungla",
  description: "Resumen, comisiones, declaraciones y confirmaciones de Caja.",
};

export default function AdminCajaPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Caja"
        description="Control de obligaciones, declaraciones de vendedores y confirmaciones de efectivo recibido. Premios y créditos son independientes."
      />
      <Suspense
        fallback={<LoadingState label="Cargando Caja…" className="mt-6" />}
      >
        <CajaAdminPanel />
      </Suspense>
    </main>
  );
}
