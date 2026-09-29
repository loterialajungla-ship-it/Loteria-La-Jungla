import Link from "next/link";

type Props = {
  fechaStr: string;
  diaAnterior: string;
  diaSiguiente: string | null;
  maxFecha: string;
};

export function NavegacionFecha({
  fechaStr,
  diaAnterior,
  diaSiguiente,
  maxFecha,
}: Props) {
  return (
    <nav
      aria-label="Navegación por fecha"
      className="rounded-2xl border border-emerald-800 bg-emerald-900/50 p-3 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/?fecha=${diaAnterior}`}
          className="rounded-xl border border-emerald-700 bg-emerald-950/60 px-3 py-2.5 text-sm font-semibold text-emerald-100 hover:border-emerald-500 hover:bg-emerald-900"
        >
          ‹ Día anterior
        </Link>

        {diaSiguiente ? (
          <Link
            href={diaSiguiente === maxFecha ? "/" : `/?fecha=${diaSiguiente}`}
            className="rounded-xl border border-emerald-700 bg-emerald-950/60 px-3 py-2.5 text-sm font-semibold text-emerald-100 hover:border-emerald-500 hover:bg-emerald-900"
          >
            Día siguiente ›
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-xl border border-emerald-900/80 px-3 py-2.5 text-sm font-semibold text-emerald-700"
          >
            Día siguiente ›
          </span>
        )}
      </div>

      <form method="get" action="/" className="mt-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-emerald-300">
          Ir a una fecha
          <input
            type="date"
            name="fecha"
            defaultValue={fechaStr}
            max={maxFecha}
            className="rounded-xl border border-emerald-700 bg-emerald-950/70 px-3 py-3 text-base text-emerald-50 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
          />
        </label>
        <button
          type="submit"
          className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-3 text-base font-semibold text-emerald-950 hover:bg-amber-300"
        >
          Ver fecha
        </button>
      </form>
    </nav>
  );
}
