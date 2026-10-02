import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  AnimalNotFoundError,
  ConfigurationError,
  DrawClosedError,
  IdempotencyConflictError,
} from "@/lib/tickets/errors";
import { getMultiplicadorPremio } from "@/lib/tickets/ticket-config";
import { generarCodigoPublico } from "@/lib/tickets/ticket-code";
import { formatearNumeroVisible } from "@/lib/tickets/ticket-number";
import {
  esHoraAbiertaParaVenta,
  horaActualVenezuela,
} from "@/lib/tickets/draw-hours";
import { buildIdempotencyRequestHash } from "@/lib/tickets/idempotency";
import {
  sumarImportes,
  validarFechaJuegoHoy,
  validarLineasBasicas,
} from "@/lib/tickets/ticket-validation";
import type {
  CreateTicketInput,
  CreateTicketResult,
  TicketCreado,
} from "@/lib/tickets/types";

const MAX_INTENTOS_CODIGO = 5;

type TxClient = Prisma.TransactionClient;

async function siguienteSecuenciaDiaria(
  tx: TxClient,
  fechaJuego: Date,
): Promise<number> {
  const filas = await tx.$queryRaw<{ ultimoNumero: number }[]>`
    INSERT INTO "TicketCounter" ("fechaJuego", "ultimoNumero")
    VALUES (${fechaJuego}::date, 1)
    ON CONFLICT ("fechaJuego")
    DO UPDATE SET "ultimoNumero" = "TicketCounter"."ultimoNumero" + 1
    RETURNING "ultimoNumero"
  `;

  const secuencia = filas[0]?.ultimoNumero;
  if (typeof secuencia !== "number" || secuencia < 1) {
    throw new Error("No se pudo obtener la secuencia del TicketCounter.");
  }

  return secuencia;
}

async function generarCodigoPublicoUnico(tx: TxClient): Promise<string> {
  for (let intento = 0; intento < MAX_INTENTOS_CODIGO; intento++) {
    const codigo = generarCodigoPublico();
    const existe = await tx.ticket.findUnique({
      where: { codigoPublico: codigo },
      select: { id: true },
    });
    if (!existe) {
      return codigo;
    }
  }

  throw new Error(
    "No se pudo generar un codigoPublico único tras varios intentos.",
  );
}

function mapTicketCreado(ticket: {
  id: string;
  numeroVisible: string;
  codigoPublico: string;
  fechaJuego: Date;
  vendedorId: string | null;
  totalApostado: Prisma.Decimal;
  multiplicadorUsado: number;
  estado: TicketCreado["estado"];
  createdAt: Date;
  lineas: {
    id: string;
    hora: number;
    numeroAnimal: string;
    nombreAnimalSnapshot: string;
    importe: Prisma.Decimal;
  }[];
}): TicketCreado {
  return {
    id: ticket.id,
    numeroVisible: ticket.numeroVisible,
    codigoPublico: ticket.codigoPublico,
    fechaJuego: fechaAYYYYMMDD(ticket.fechaJuego),
    vendedorId: ticket.vendedorId,
    totalApostado: ticket.totalApostado.toFixed(2),
    multiplicadorUsado: ticket.multiplicadorUsado,
    estado: ticket.estado,
    createdAt: ticket.createdAt,
    lineas: ticket.lineas.map((linea) => ({
      id: linea.id,
      hora: linea.hora,
      numeroAnimal: linea.numeroAnimal,
      nombreAnimalSnapshot: linea.nombreAnimalSnapshot,
      importe: linea.importe.toFixed(2),
    })),
  };
}

function resolverReplay(args: {
  existing: {
    vendedorId: string | null;
    idempotencyRequestHash: string | null;
  } & Parameters<typeof mapTicketCreado>[0];
  vendedorId: string;
  requestHash: string;
}): CreateTicketResult {
  const { existing, vendedorId, requestHash } = args;

  if (existing.vendedorId !== vendedorId) {
    throw new IdempotencyConflictError("Esta operación no puede reutilizarse.");
  }
  if (existing.idempotencyRequestHash !== requestHash) {
    throw new IdempotencyConflictError(
      "Esta clave de operación ya fue utilizada con otros datos.",
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
  }

  return {
    ticket: mapTicketCreado(existing),
    idempotentReplay: true,
  };
}

function esConflictoIdempotencyKey(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  if (typeof target === "string") {
    return target.includes("idempotencyKey");
  }
  if (Array.isArray(target)) {
    return target.some((t) => String(t).includes("idempotencyKey"));
  }
  return false;
}

/**
 * Crea un ticket EMITIDO con sus líneas en una sola transacción.
 * Idempotencia: UNIQUE(idempotencyKey) + requestHash + vendedorId de sesión.
 */
export async function createTicket(
  input: CreateTicketInput,
  ahora = new Date(),
): Promise<CreateTicketResult> {
  const fechaJuego = validarFechaJuegoHoy(input.fechaJuego, ahora);
  const lineasBasicas = validarLineasBasicas(input.lineas);
  const vendedorId =
    input.vendedorId === undefined || input.vendedorId === ""
      ? null
      : input.vendedorId;

  if (!vendedorId) {
    throw new ConfigurationError(
      "vendedorId de sesión requerido para emitir tickets.",
    );
  }

  const idempotencyKey = input.idempotencyKey;
  if (!idempotencyKey) {
    throw new ConfigurationError("idempotencyKey requerida.");
  }

  const fechaStr = fechaAYYYYMMDD(fechaJuego);
  const requestHash = buildIdempotencyRequestHash({
    fechaJuego: fechaStr,
    lineas: lineasBasicas.map((l) => ({
      hora: l.hora,
      numeroAnimal: l.numeroAnimal,
      importe: l.importe.toFixed(2),
    })),
  });

  const numerosUnicos = Array.from(
    new Set(lineasBasicas.map((l) => l.numeroAnimal)),
  );

  const includeLineas = {
    lineas: {
      orderBy: [{ hora: "asc" as const }, { numeroAnimal: "asc" as const }],
    },
  };

  // Fast-path: evita consumir TicketCounter en replay.
  const existente = await prisma.ticket.findUnique({
    where: { idempotencyKey },
    include: includeLineas,
  });
  if (existente) {
    return resolverReplay({
      existing: existente,
      vendedorId,
      requestHash,
    });
  }

  try {
    const ticket = await prisma.$transaction(
      async (tx) => {
      const multiplicadorUsado = await getMultiplicadorPremio(tx);
      if (!Number.isInteger(multiplicadorUsado) || multiplicadorUsado <= 0) {
        throw new ConfigurationError("Multiplicador inválido.");
      }

      const resultados = await tx.resultado.findMany({
        where: { fecha: fechaJuego },
        select: { hora: true },
      });
      const horasConResultado = new Set(resultados.map((r) => r.hora));
      const horaActualVe = horaActualVenezuela(ahora);

      for (const linea of lineasBasicas) {
        if (
          !esHoraAbiertaParaVenta({
            hora: linea.hora,
            horaActualVe,
            horasConResultado,
          })
        ) {
          throw new DrawClosedError(linea.hora);
        }
      }

      const animales = await tx.animal.findMany({
        where: { numero: { in: numerosUnicos } },
        select: { numero: true, nombre: true },
      });

      if (animales.length !== numerosUnicos.length) {
        const hallados = new Set(animales.map((a) => a.numero));
        const faltantes = numerosUnicos.filter((n) => !hallados.has(n));
        throw new AnimalNotFoundError(faltantes);
      }

      const nombrePorNumero = new Map(
        animales.map((a) => [a.numero, a.nombre] as const),
      );

      const totalApostado = sumarImportes(lineasBasicas.map((l) => l.importe));
      const secuencia = await siguienteSecuenciaDiaria(tx, fechaJuego);
      const numeroVisible = formatearNumeroVisible(fechaJuego, secuencia);
      const codigoPublico = await generarCodigoPublicoUnico(tx);

      const created = await tx.ticket.create({
        data: {
          numeroVisible,
          codigoPublico,
          fechaJuego,
          vendedorId,
          totalApostado,
          estado: "EMITIDO",
          multiplicadorUsado,
          idempotencyKey,
          idempotencyRequestHash: requestHash,
          lineas: {
            create: lineasBasicas.map((linea) => ({
              fechaJuego,
              hora: linea.hora,
              numeroAnimal: linea.numeroAnimal,
              nombreAnimalSnapshot: nombrePorNumero.get(linea.numeroAnimal)!,
              importe: linea.importe,
            })),
          },
        },
        include: includeLineas,
      });

      await recordAuditEvent(tx, {
        usuarioId: vendedorId,
        accion: "CREAR_TICKET",
        entidad: "TICKET",
        entidadId: created.id,
        detalle: {
          numeroVisible: created.numeroVisible,
          totalApostado: created.totalApostado.toFixed(2),
          fechaJuego: fechaStr,
        },
      });

      return created;
    },
      {
        // Necesario bajo concurrencia real (Neon / pool): evita fallos
        // "Unable to start a transaction in the given time" / "Transaction already closed".
        maxWait: 30_000,
        timeout: 60_000,
      },
    );

    return {
      ticket: mapTicketCreado(ticket),
      idempotentReplay: false,
    };
  } catch (error) {
    if (!esConflictoIdempotencyKey(error)) {
      throw error;
    }

    const race = await prisma.ticket.findUnique({
      where: { idempotencyKey },
      include: includeLineas,
    });
    if (!race) {
      throw error;
    }
    return resolverReplay({
      existing: race,
      vendedorId,
      requestHash,
    });
  }
}
