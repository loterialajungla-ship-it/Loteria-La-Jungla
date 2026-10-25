import { AnimalResultadoImagen } from "@/components/AnimalResultadoImagen";
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

function etiquetaPendiente(
  esHoy: boolean,
  hora: number,
  ahora: Date,
): { texto: string; clase: string } {
  if (!esHoy) {
    return {
      texto: "Sin resultado",
      clase: "text-emerald-300/80",
    };
  }
  if (haLlegadoFranja(hora, ahora)) {
    return {
      texto: "Aún no publicado",
      clase: "text-amber-200",
    };
  }
  return {
    texto: "Próximamente",
    clase: "text-emerald-400/80",
  };
}

export function FranjasResultados({
  esHoy,
  horaActual,
  porHora,
  ahora = new Date(),
}: Props) {
  const publicados = HORAS_SORTEO.filter((h) => porHora.has(h)).length;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Sorteos del día
        </h2>
        <p className="text-xs font-medium tabular-nums text-emerald-400/90">
          {publicados}/{HORAS_SORTEO.length} publicados
        </p>
      </div>

      {publicados === 0 && !esHoy ? (
        <p className="mb-4 rounded-lj-lg border border-dashed border-emerald-800 bg-emerald-950/40 px-4 py-5 text-center text-sm text-emerald-300">
          No hay resultados publicados para esta fecha.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2.5">
        {HORAS_SORTEO.map((hora) => {
          const resultado = porHora.get(hora);
          const esHoraActual = esHoy && horaActual === hora;
          const pendiente = etiquetaPendiente(esHoy, hora, ahora);

          return (
            <li
              key={hora}
              className={`rounded-lj-lg border px-4 py-3.5 sm:px-5 ${
                esHoraActual
                  ? "border-amber-400 bg-emerald-900 shadow-lg shadow-emerald-950/40"
                  : resultado
                    ? "border-emerald-700/80 bg-emerald-900/70"
                    : "border-emerald-800/80 bg-emerald-950/50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold tabular-nums text-emerald-200">
                  {formatearHoraSorteo(hora)}
                </p>
                {esHoraActual ? (
                  <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                    Ahora
                  </span>
                ) : null}
                {resultado ? (
                  <span className="rounded-full border border-emerald-600/60 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
                    Publicado
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                    Pendiente
                  </span>
                )}
              </div>

              {resultado ? (
                <div className="mt-2 flex items-center gap-3 sm:gap-4">
                  <AnimalResultadoImagen
                    numero={resultado.numero}
                    nombre={resultado.nombre}
                    priority={hora <= 11}
                  />
                  <p className="min-w-0 text-2xl font-bold leading-tight tracking-tight text-emerald-50 sm:text-3xl">
                    <span className="font-mono tabular-nums">
                      {resultado.numero}
                    </span>
                    <span className="mx-1.5 font-normal text-emerald-400">
                      —
                    </span>
                    <span>{resultado.nombre}</span>
                  </p>
                </div>
              ) : (
                <p className={`mt-2 text-lg font-semibold ${pendiente.clase}`}>
                  {pendiente.texto}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
