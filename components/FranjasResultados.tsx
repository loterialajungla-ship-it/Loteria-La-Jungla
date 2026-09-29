import {
  HORAS_SORTEO,
  formatearHoraSorteo,
  haLlegadoFranja,
} from "@/lib/fecha";

export type ResultadoFranja = {
  numero: string;
  nombre: string;
};

type Props = {
  esHoy: boolean;
  horaActual: number;
  porHora: Map<number, ResultadoFranja>;
  ahora?: Date;
};

export function FranjasResultados({
  esHoy,
  horaActual,
  porHora,
  ahora = new Date(),
}: Props) {
  return (
    <ol className="flex flex-col gap-3">
      {HORAS_SORTEO.map((hora) => {
        const resultado = porHora.get(hora);
        const esHoraActual = esHoy && horaActual === hora;

        return (
          <li
            key={hora}
            className={`rounded-2xl border px-4 py-4 sm:px-5 ${
              esHoraActual
                ? "border-amber-400 bg-emerald-900 shadow-lg shadow-emerald-950/40"
                : "border-emerald-800 bg-emerald-900/60"
            }`}
          >
            <p className="text-sm font-semibold text-emerald-300">
              {formatearHoraSorteo(hora)}
              {esHoraActual ? (
                <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-300">
                  Ahora
                </span>
              ) : null}
            </p>

            {resultado ? (
              <p className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">
                {resultado.numero} - {resultado.nombre}
              </p>
            ) : esHoy ? (
              haLlegadoFranja(hora, ahora) ? (
                <p className="mt-1 text-lg font-semibold text-amber-200/90">
                  Aún no publicado
                </p>
              ) : (
                <p className="mt-1 text-lg font-medium text-emerald-400/70">
                  Próximamente
                </p>
              )
            ) : (
              <p className="mt-1 text-lg font-medium text-emerald-400/80">
                Sin resultado
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
