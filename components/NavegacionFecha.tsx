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
  const navBtn =
    "inline-flex min-h-11 items-center justify-center rounded-lj-md border border-emerald-700 bg-emerald-950/60 px-3 py-2.5 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-500 hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950";

  return (
    <nav
      aria-label="Navegación por fecha"
      className="rounded-lj-lg border border-emerald-800 bg-emerald-900/50 p-3 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <Link href={`/?fecha=${diaAnterior}`} className={navBtn}>
          ‹ Día anterior
        </Link>

        {diaSiguiente ? (
          <Link
            href={diaSiguiente === maxFecha ? "/" : `/?fecha=${diaSiguiente}`}
            className={navBtn}
          >
            Día siguiente ›
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-lj-md border border-emerald-900/80 px-3 py-2.5 text-sm font-semibold text-emerald-700"
          >
            Día siguiente ›
          </span>
        )}
      </div>

      <form method="get" action="/" className="mt-3 w-full min-w-0">
        <label className="flex w-full min-w-0 flex-col gap-2 text-sm font-medium text-emerald-300">
          Ir a una fecha
          <input
            type="date"
            name="fecha"
            defaultValue={fechaStr}
            max={maxFecha}
            className="box-border min-h-12 w-full min-w-0 max-w-full rounded-lj-md border border-emerald-700 bg-emerald-950/70 px-3 py-3 text-base text-emerald-50 outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/30"
          />
        </label>
        <button
          type="submit"
          className="mt-3 min-h-12 w-full rounded-lj-md bg-amber-400 px-4 py-3 text-base font-bold text-emerald-950 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
        >
          Ver fecha
        </button>
      </form>
    </nav>
  );
}
