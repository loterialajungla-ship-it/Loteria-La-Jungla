import type { Metadata } from "next";
import Link from "next/link";
import { TicketPOS } from "@/components/tickets/TicketPOS";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getOpenDrawHours } from "@/lib/tickets/get-open-draw-hours";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Punto de venta — Lotería La Jungla",
  description: "Emisión de tickets para el día de hoy.",
};

function ordenAnimal(numero: string): number {
  if (numero === "0") return -1;
  if (numero === "00") return 0;
  return Number(numero);
}

export default async function VentaPage() {
  const [disponibilidad, animalesRaw, user] = await Promise.all([
    getOpenDrawHours(prisma),
    prisma.animal.findMany({
      select: { numero: true, nombre: true },
    }),
    getCurrentUser(),
  ]);

  const animales = animalesRaw
    .slice()
    .sort((a, b) => ordenAnimal(a.numero) - ordenAnimal(b.numero));

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href="/venta/tickets"
              className="font-semibold text-emerald-800 underline underline-offset-2"
            >
              Mis tickets
            </Link>
            <Link
              href="/perfil"
              className="font-semibold text-emerald-800 underline underline-offset-2"
            >
              Mi cuenta
            </Link>
            {user?.rol === "ADMIN" ? (
              <Link
                href="/admin"
                className="font-semibold text-emerald-800 underline underline-offset-2"
              >
                Admin
              </Link>
            ) : null}
          </div>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="font-semibold text-stone-600 underline underline-offset-2"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <TicketPOS
        fechaJuego={disponibilidad.fechaJuego}
        horasIniciales={disponibilidad.horas}
        animales={animales}
      />
    </div>
  );
}
