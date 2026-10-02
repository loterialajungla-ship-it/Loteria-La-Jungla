import { Prisma } from "@prisma/client";

export type EstadoLineaPublico = "PENDIENTE" | "NO_GANADORA" | "GANADORA";

export type EstadoTicketPublico =
  | "ANULADO"
  | "PENDIENTE"
  | "GANADOR"
  | "NO_GANADOR";

export type ResultadoSorteoRef = {
  numero: string;
  nombre: string;
} | null;

export type LineaParaLiquidar = {
  id: string;
  hora: number;
  numeroAnimal: string;
  nombreAnimalSnapshot: string;
  importe: Prisma.Decimal | string;
};

/**
 * Decisión de premioTotal con líneas pendientes:
 * - Se suma el premio ya confirmado de líneas GANADORAS.
 * - `liquidacionCompleta === false` indica que el ticket aún no está cerrado.
 * - UI debe etiquetar como “Premio acumulado” si no está completa.
 */
export type LineaPublicaLiquidada = {
  id: string;
  hora: number;
  numeroAnimal: string;
  nombreAnimal: string;
  importe: string;
  estado: EstadoLineaPublico;
  premio: string | null;
  resultadoNumero: string | null;
  resultadoNombre: string | null;
};

export function moneyToFixed2(value: Prisma.Decimal | string): string {
  const d =
    typeof value === "string" ? new Prisma.Decimal(value) : value;
  return d.toFixed(2);
}

export function liquidarLineaPublica(args: {
  ticketAnulado: boolean;
  linea: LineaParaLiquidar;
  resultado: ResultadoSorteoRef;
  multiplicadorUsado: number;
}): LineaPublicaLiquidada {
  const { ticketAnulado, linea, resultado, multiplicadorUsado } = args;
  const importeStr = moneyToFixed2(linea.importe);
  const base = {
    id: linea.id,
    hora: linea.hora,
    numeroAnimal: linea.numeroAnimal,
    nombreAnimal: linea.nombreAnimalSnapshot,
    importe: importeStr,
  };

  if (!resultado) {
    return {
      ...base,
      estado: "PENDIENTE",
      premio: null,
      resultadoNumero: null,
      resultadoNombre: null,
    };
  }

  const gano = resultado.numero === linea.numeroAnimal;

  if (ticketAnulado) {
    // Nunca presentar GANADORA ni premio > 0 en ticket anulado.
    return {
      ...base,
      estado: "NO_GANADORA",
      premio: "0.00",
      resultadoNumero: resultado.numero,
      resultadoNombre: resultado.nombre,
    };
  }

  if (gano) {
    const premio = new Prisma.Decimal(importeStr)
      .mul(multiplicadorUsado)
      .toFixed(2);
    return {
      ...base,
      estado: "GANADORA",
      premio,
      resultadoNumero: resultado.numero,
      resultadoNombre: resultado.nombre,
    };
  }

  return {
    ...base,
    estado: "NO_GANADORA",
    premio: "0.00",
    resultadoNumero: resultado.numero,
    resultadoNombre: resultado.nombre,
  };
}

export function derivarEstadoTicketPublico(args: {
  ticketAnulado: boolean;
  estadosLineas: EstadoLineaPublico[];
}): EstadoTicketPublico {
  if (args.ticketAnulado) return "ANULADO";

  const hayPendiente = args.estadosLineas.some((e) => e === "PENDIENTE");
  if (hayPendiente) return "PENDIENTE";

  const hayGanadora = args.estadosLineas.some((e) => e === "GANADORA");
  return hayGanadora ? "GANADOR" : "NO_GANADOR";
}

export function calcularPremioTotalPublico(args: {
  ticketAnulado: boolean;
  lineas: Pick<LineaPublicaLiquidada, "estado" | "premio">[];
}): {
  premioTotal: string;
  liquidacionCompleta: boolean;
} {
  if (args.ticketAnulado) {
    return { premioTotal: "0.00", liquidacionCompleta: true };
  }

  const liquidacionCompleta = args.lineas.every(
    (l) => l.estado !== "PENDIENTE",
  );

  let total = new Prisma.Decimal(0);
  for (const linea of args.lineas) {
    if (linea.estado === "GANADORA" && linea.premio) {
      total = total.plus(linea.premio);
    }
  }

  return {
    premioTotal: total.toFixed(2),
    liquidacionCompleta,
  };
}
