import { Prisma } from "@prisma/client";

export type AnimalCatalogo = {
  numero: string;
  nombre: string;
};

export type LineaExposicionInput = {
  ticketId: string;
  numeroAnimal: string;
  importe: Prisma.Decimal | string;
  multiplicadorUsado: number;
};

export type AnimalExposicion = {
  numeroAnimal: string;
  nombreAnimal: string;
  totalApostado: string;
  exposicion: string;
  ticketsAfectados: number;
};

export type ExposicionSorteo = {
  fechaJuego: string;
  hora: number;
  totalApostado: string;
  totalExposicion: string;
  mayorExposicion: string;
  ticketsAfectados: number;
  animales: AnimalExposicion[];
};

function toDecimal(value: Prisma.Decimal | string): Prisma.Decimal {
  return typeof value === "string" ? new Prisma.Decimal(value) : value;
}

export function ordenCatalogoAnimal(numero: string): number {
  if (numero === "0") return -1;
  if (numero === "00") return 0;
  return Number(numero);
}

/**
 * Agrega exposición por animal.
 * Exposición por línea = importe × Ticket.multiplicadorUsado (snapshot).
 * Solo debe recibir líneas de tickets EMITIDO ya filtradas.
 */
export function aggregateExposure(args: {
  fechaJuego: string;
  hora: number;
  catalogo: AnimalCatalogo[];
  lineas: LineaExposicionInput[];
}): ExposicionSorteo {
  const porAnimal = new Map<
    string,
    {
      totalApostado: Prisma.Decimal;
      exposicion: Prisma.Decimal;
      tickets: Set<string>;
    }
  >();

  const ticketsGlobales = new Set<string>();
  let totalApostado = new Prisma.Decimal(0);
  let totalExposicion = new Prisma.Decimal(0);

  for (const linea of args.lineas) {
    const importe = toDecimal(linea.importe);
    const exposicionLinea = importe.mul(linea.multiplicadorUsado);

    totalApostado = totalApostado.plus(importe);
    totalExposicion = totalExposicion.plus(exposicionLinea);
    ticketsGlobales.add(linea.ticketId);

    const actual = porAnimal.get(linea.numeroAnimal) ?? {
      totalApostado: new Prisma.Decimal(0),
      exposicion: new Prisma.Decimal(0),
      tickets: new Set<string>(),
    };
    actual.totalApostado = actual.totalApostado.plus(importe);
    actual.exposicion = actual.exposicion.plus(exposicionLinea);
    actual.tickets.add(linea.ticketId);
    porAnimal.set(linea.numeroAnimal, actual);
  }

  const catalogoOrdenado = args.catalogo
    .slice()
    .sort(
      (a, b) => ordenCatalogoAnimal(a.numero) - ordenCatalogoAnimal(b.numero),
    );

  const animales: AnimalExposicion[] = catalogoOrdenado.map((animal) => {
    const agg = porAnimal.get(animal.numero);
    return {
      numeroAnimal: animal.numero,
      nombreAnimal: animal.nombre,
      totalApostado: (agg?.totalApostado ?? new Prisma.Decimal(0)).toFixed(2),
      exposicion: (agg?.exposicion ?? new Prisma.Decimal(0)).toFixed(2),
      ticketsAfectados: agg?.tickets.size ?? 0,
    };
  });

  let mayor = new Prisma.Decimal(0);
  for (const animal of animales) {
    const exp = new Prisma.Decimal(animal.exposicion);
    if (exp.gt(mayor)) mayor = exp;
  }

  return {
    fechaJuego: args.fechaJuego,
    hora: args.hora,
    totalApostado: totalApostado.toFixed(2),
    totalExposicion: totalExposicion.toFixed(2),
    mayorExposicion: mayor.toFixed(2),
    ticketsAfectados: ticketsGlobales.size,
    animales,
  };
}
