import type { Metadata } from "next";
import { TicketPOS } from "@/components/tickets/TicketPOS";
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
  const [disponibilidad, animalesRaw] = await Promise.all([
    getOpenDrawHours(prisma),
    prisma.animal.findMany({
      select: { numero: true, nombre: true },
    }),
  ]);

  const animales = animalesRaw
    .slice()
    .sort((a, b) => ordenAnimal(a.numero) - ordenAnimal(b.numero));

  return (
    <TicketPOS
      fechaJuego={disponibilidad.fechaJuego}
      horasIniciales={disponibilidad.horas}
      animales={animales}
    />
  );
}
