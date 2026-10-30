import type { Metadata } from "next";
import { Suspense } from "react";
import { CreditosAdminPanel } from "@/components/creditos/CreditosAdminPanel";
import { LoadingState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Créditos — Admin — Lotería La Jungla",
  description: "Administración de créditos de vendedores.",
};

export default function AdminCreditosPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        brand=""
        title="Créditos de vendedores"
        description="Consulta saldos, asigna o retira créditos y configura el control. El backend es la autoridad financiera; esta pantalla solo consume la API administrativa."
      />
      <Suspense
        fallback={<LoadingState label="Cargando créditos…" className="mt-6" />}
      >
        <CreditosAdminPanel />
      </Suspense>
    </main>
  );
}
