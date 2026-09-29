import type { Metadata } from "next";
import Link from "next/link";
import { AdminFilaResultado } from "@/app/admin/AdminFilaResultado";
import {
  HORAS_SORTEO,
  formatearFechaLargaDesdeDate,
  formatearHoraSorteo,
  hoyYYYYMMDD,
  parseFechaYYYYMMDD,
} from "@/lib/fecha";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Lotería La Jungla",
  description: "Carga de resultados de Lotería La Jungla.",
};

type Props = {
  searchParams: { fecha?: string };
};

function ordenAnimal(numero: string): number {
  if (numero === "0") return -1;
  if (numero === "00") return 0;
  return Number(numero);
}

export default async function AdminPage({ searchParams }: Props) {
  const fechaParam = searchParams.fecha;
  const fechaParseada =
    typeof fechaParam === "string" ? parseFechaYYYYMMDD(fechaParam) : null;
  const fechaStr = fechaParseada
    ? fechaParam!.trim()
    : hoyYYYYMMDD();
  const fecha = parseFechaYYYYMMDD(fechaStr)!;

  const [animalesRaw, resultados] = await Promise.all([
    prisma.animal.findMany(),
    prisma.resultado.findMany({
      where: { fecha },
      include: { animal: true },
    }),
  ]);

  const animales = animalesRaw
    .slice()
    .sort((a, b) => ordenAnimal(a.numero) - ordenAnimal(b.numero))
    .map((animal) => ({ numero: animal.numero, nombre: animal.nombre }));

  const porHora = new Map(resultados.map((r) => [r.hora, r]));

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Lotería La Jungla
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Cargar resultados
            </h1>
            <p className="mt-2 text-stone-600">
              {formatearFechaLargaDesdeDate(fecha)}
            </p>
          </div>

          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Cerrar sesión
            </button>
          </form>
        </div>

        <form method="get" className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-2 text-sm font-medium text-stone-700">
            Fecha
            <input
              type="date"
              name="fecha"
              defaultValue={fechaStr}
              className="rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>
          <button
            type="submit"
            className="mt-3 w-full rounded-xl bg-stone-800 px-4 py-3 text-base font-semibold text-white hover:bg-stone-700"
          >
            Ver fecha
          </button>
        </form>

        <p className="mt-4 text-sm text-stone-500">
          <Link href="/" className="underline underline-offset-2 hover:text-stone-800">
            Ver página pública
          </Link>
        </p>

        <ol className="mt-6 flex flex-col gap-3">
          {HORAS_SORTEO.map((hora) => {
            const actual = porHora.get(hora);
            return (
              <AdminFilaResultado
                key={hora}
                fecha={fechaStr}
                hora={hora}
                horaLabel={formatearHoraSorteo(hora)}
                animales={animales}
                numeroInicial={actual?.numero ?? ""}
              />
            );
          })}
        </ol>
      </main>
    </div>
  );
}
