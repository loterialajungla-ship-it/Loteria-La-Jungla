import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CajaVendorPanel } from "@/components/caja/CajaVendorPanel";
import { LoadingState, PageHeader } from "@/components/ui";
import { getAuthContext } from "@/lib/auth/current-user";
import { decideVentaCajaAccess } from "@/lib/caja/venta-caja-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi Caja — Lotería La Jungla",
  description: "Resumen de entregas, declaraciones y confirmaciones de Caja.",
};

export default async function VentaCajaPage() {
  const { user } = await getAuthContext();
  const access = decideVentaCajaAccess(user?.rol);
  if (access.kind === "redirect") {
    redirect(access.to);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Mi Caja"
        description="Consulta lo que debes entregar, declara entregas de efectivo y revisa qué ha confirmado ADMIN."
      />
      <Suspense
        fallback={<LoadingState label="Cargando Mi Caja…" className="mt-6" />}
      >
        <CajaVendorPanel />
      </Suspense>
    </main>
  );
}
