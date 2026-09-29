import type { Metadata } from "next";
import { FranjasResultados } from "@/components/FranjasResultados";
import { NavegacionFecha } from "@/components/NavegacionFecha";
import { prisma } from "@/lib/prisma";
import {
  ahoraVenezuela,
  fechaAYYYYMMDD,
  formatearFechaLargaDesdeDate,
  hoyYYYYMMDD,
  resolverFechaConsulta,
  sumarDiasUTC,
} from "@/lib/fecha";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lotería La Jungla - Resultados de hoy",
  description:
    "Consulta los resultados de hoy en Lotería La Jungla, sorteo por sorteo, hora Venezuela.",
};

type Props = {
  searchParams: { fecha?: string };
};

export default async function PaginaResultados({ searchParams }: Props) {
  const ahora = new Date();
  const { fecha, fechaStr, esHoy } = resolverFechaConsulta(
    searchParams.fecha,
    ahora,
  );
  const horaActual = ahoraVenezuela(ahora).hour;
  const hoyStr = hoyYYYYMMDD(ahora);

  const resultados = await prisma.resultado.findMany({
    where: { fecha },
    include: { animal: true },
  });

  const porHora = new Map(
    resultados.map((resultado) => [
      resultado.hora,
      { numero: resultado.numero, nombre: resultado.animal.nombre },
    ]),
  );

  const diaAnterior = fechaAYYYYMMDD(sumarDiasUTC(fecha, -1));
  const diaSiguiente = esHoy
    ? null
    : fechaAYYYYMMDD(sumarDiasUTC(fecha, 1));

  return (
    <div className="min-h-screen bg-emerald-950 text-emerald-50">
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-wide text-emerald-300">
          Lotería La Jungla
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          {esHoy ? "Resultados de hoy" : "Resultados"}
        </h1>
        <p
          className={`mt-2 text-base ${
            esHoy ? "text-emerald-200/90" : "text-lg font-semibold text-amber-200"
          }`}
        >
          {formatearFechaLargaDesdeDate(fecha)}
        </p>

        <div className="mt-6">
          <NavegacionFecha
            fechaStr={fechaStr}
            diaAnterior={diaAnterior}
            diaSiguiente={diaSiguiente}
            maxFecha={hoyStr}
          />
        </div>

        <div className="mt-6">
          <FranjasResultados
            esHoy={esHoy}
            horaActual={horaActual}
            porHora={porHora}
            ahora={ahora}
          />
        </div>
      </main>
    </div>
  );
}
