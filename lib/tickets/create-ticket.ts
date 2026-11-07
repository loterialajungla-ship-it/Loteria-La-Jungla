import { Prisma, type PrismaClient, type RolUsuario } from "@prisma/client";
import { fechaAYYYYMMDD } from "@/lib/fecha";
import { recordAuditEvent } from "@/lib/audit/audit";
import {
  assertVendedorElegibleParaAtribucion,
  maybeCreateCajaObligacionEnTx,
} from "@/lib/caja/obligacion";
import { consumirCreditosTrasEmitirTicket } from "@/lib/creditos/aplicar-en-venta";
import { createPrismaCreditosStore } from "@/lib/creditos/prisma-store";
import type { CreditosStore } from "@/lib/creditos/store";
import {
  AnimalNotFoundError,
  ConfigurationError,
  DrawClosedError,
  IdempotencyConflictError,
  TicketSellerNotAllowedError,
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

type CreateTicketDb = Pick<PrismaClient, "ticket" | "usuario" | "$transaction">;

/**
 * Lazy: evita cargar el motor Prisma al importar este módulo en unit tests
 * que siempre inyectan `db`. En runtime HTTP se resuelve el singleton guarded.
 */
function defaultCreateTicketDb(): CreateTicketDb {
  // require evitado en carga estática; ok en servidor Node / Next.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/prisma").prisma as CreateTicketDb;
}

export type CreateTicketOptions = {
  /**
   * Rol del actor autenticado (sesión). ADMIN no consume créditos.
   * Por defecto VENDEDOR (comportamiento estricto si se omite en tests).
   * No debe tomarse de un body HTTP.
   */
  actorRol?: RolUsuario;
  /**
   * Id del usuario autenticado (sesión). Si se omite, se usa `input.vendedorId`
   * (compatibilidad con tests existentes).
   */
  actorUserId?: string;
  /**
   * Solo ADMIN: atribución explícita a un VENDEDOR activo.
   * VENDEDOR no puede atribuir a otro; si se pasa distinto de sí mismo → rechazo.
   * No consume créditos del vendedor atribuido.
   */
  atribuidoAVendedorId?: string | null;
  /**
   * Inyectable para unit tests. Por defecto: adaptador Prisma sobre la TX.
   */
  bindCreditsStore?: (tx: Prisma.TransactionClient) => CreditosStore;
  /**
   * Solo pruebas: se invoca dentro de la TX justo después del FOR UPDATE del
   * emisor (antes de crear ticket / créditos). Permite barreras deterministas
   * de concurrencia sin sleep arbitrario. No usar en rutas HTTP.
   */
  afterEmisorLocked?: () => Promise<void>;
  /**
   * Solo pruebas (integración): tras ticket + auditoría CREAR_TICKET,
   * antes de la obligación de Caja. No usar en rutas HTTP.
   */
  beforeCajaObligacion?: () => Promise<void>;
  /**
   * Solo pruebas (integración): tras maybeCreateCajaObligacionEnTx,
   * antes del consumo de créditos. No usar en rutas HTTP.
   */
  afterCajaObligacion?: () => Promise<void>;
};

/** Puerto mínimo para validar emisor (inyectable en unit tests). */
export type EmisorTicketLookup = {
  usuario: {
    findUnique: (args: {
      where: { id: string };
      select?: { id: true; rol: true; activo: true };
    }) => Promise<{ id: string; rol: RolUsuario; activo: boolean } | null>;
  };
};

export type EmisorTicketRow = {
  id: string;
  rol: RolUsuario;
  activo: boolean;
};

/** Cliente mínimo para bloqueo FOR UPDATE del emisor (TX interactiva). */
export type EmisorLockTx = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Autoridad de dominio sobre una fila ya leída (con o sin bloqueo).
 * No confía en un rol enviado en el body HTTP.
 */
export function assertEmisorRowPuedeCrearTicket(
  user: EmisorTicketRow | null,
  args: { vendedorId: string; actorRol: RolUsuario },
): EmisorTicketRow {
  if (!user) {
    throw new TicketSellerNotAllowedError("Usuario emisor no encontrado.");
  }
  if (!user.activo) {
    throw new TicketSellerNotAllowedError("El usuario emisor está inactivo.");
  }
  if (user.rol !== args.actorRol) {
    throw new TicketSellerNotAllowedError(
      "Rol del emisor incompatible con la sesión.",
    );
  }
  if (args.actorRol !== "ADMIN" && args.actorRol !== "VENDEDOR") {
    throw new TicketSellerNotAllowedError(
      "Rol no autorizado para emitir tickets.",
    );
  }
  return user;
}

/**
 * Lectura sin bloqueo (optimización / tests). No es la autorización definitiva
 * de una emisión nueva: esa ocurre en `lockAndAssertEmisorPuedeCrearTicket`.
 */
export async function assertEmisorPuedeCrearTicket(
  db: EmisorTicketLookup,
  args: { vendedorId: string; actorRol: RolUsuario },
): Promise<void> {
  const user = await db.usuario.findUnique({
    where: { id: args.vendedorId },
    select: { id: true, rol: true, activo: true },
  });
  assertEmisorRowPuedeCrearTicket(user, args);
}

/**
 * Bloquea la fila `Usuario` (`SELECT … FOR UPDATE`) y revalida activo/rol.
 * Debe ejecutarse dentro de la misma TX que crea el ticket (antes del create
 * y antes de bloquear `VendedorCreditoCuenta` → orden Usuario → cuenta).
 */
export async function lockAndAssertEmisorPuedeCrearTicket(
  tx: EmisorLockTx,
  args: { vendedorId: string; actorRol: RolUsuario },
): Promise<EmisorTicketRow> {
  const id = args.vendedorId.trim();
  if (!id) {
    throw new TicketSellerNotAllowedError("Usuario emisor no encontrado.");
  }

  const rows = await tx.$queryRaw<EmisorTicketRow[]>`
    SELECT id, rol, activo
    FROM "Usuario"
    WHERE id = ${id}
    FOR UPDATE
  `;

  return assertEmisorRowPuedeCrearTicket(rows[0] ?? null, {
    vendedorId: id,
    actorRol: args.actorRol,
  });
}

/**
 * Crea un ticket EMITIDO con sus líneas en una sola transacción.
 * Idempotencia: UNIQUE(idempotencyKey) + requestHash + Ticket.vendedorId.
 *
 * Atribución (C3): VENDEDOR → siempre sí mismo. ADMIN → opcionalmente un
 * VENDEDOR activo (`atribuidoAVendedorId`); sin atribución = venta ADMIN
 * (sin obligación de Caja).
 *
 * Caja: si activa y ticket elegible (vendedor VENDEDOR + createdAt ≥ activadaEn),
 * crea `CajaObligacion` en la misma TX (snapshot de comisión). Fallo → rollback.
 *
 * Créditos: siguen ligados al actor de sesión (VENDEDOR emisor). ADMIN no
 * consume; la atribución NO toca créditos del vendedor atribuido.
 *
 * `db` opcional: en integración/aceptación pasar el cliente de
 * `createIntegrationPrismaClient`. Por defecto usa `@/lib/prisma`
 * (guarded si RUN_INTEGRATION / RUN_ACCEPTANCE).
 */
export async function createTicket(
  input: CreateTicketInput,
  ahora = new Date(),
  db: CreateTicketDb = defaultCreateTicketDb(),
  options: CreateTicketOptions = {},
): Promise<CreateTicketResult> {
  const actorRol: RolUsuario = options.actorRol ?? "VENDEDOR";
  const bindCreditsStore =
    options.bindCreditsStore ??
    ((tx: Prisma.TransactionClient) =>
      createPrismaCreditosStore(tx, { alreadyInTransaction: true }));
  const fechaJuego = validarFechaJuegoHoy(input.fechaJuego, ahora);
  const lineasBasicas = validarLineasBasicas(input.lineas);

  let actorUserId: string | null = null;
  const fromOptions = options.actorUserId?.trim();
  if (fromOptions) {
    actorUserId = fromOptions;
  } else if (
    typeof input.vendedorId === "string" &&
    input.vendedorId.trim() !== ""
  ) {
    actorUserId = input.vendedorId.trim();
  }

  if (!actorUserId) {
    throw new ConfigurationError(
      "vendedorId de sesión requerido para emitir tickets.",
    );
  }

  const atribuidoRaw =
    options.atribuidoAVendedorId !== undefined
      ? options.atribuidoAVendedorId
      : input.atribuidoAVendedorId;
  const atribuidoAVendedorId =
    typeof atribuidoRaw === "string" && atribuidoRaw.trim()
      ? atribuidoRaw.trim()
      : null;

  // Resolver Ticket.vendedorId (atribuido o emisor).
  let ticketVendedorId: string;
  if (actorRol === "VENDEDOR") {
    if (atribuidoAVendedorId && atribuidoAVendedorId !== actorUserId) {
      throw new TicketSellerNotAllowedError(
        "Un vendedor no puede atribuir la venta a otro usuario.",
        "SELLER_ATTRIBUTION_FORBIDDEN",
      );
    }
    ticketVendedorId = actorUserId;
  } else if (actorRol === "ADMIN") {
    if (atribuidoAVendedorId) {
      // Fast-fail fuera de TX; se revalida dentro.
      await assertVendedorElegibleParaAtribucion(db, atribuidoAVendedorId);
      ticketVendedorId = atribuidoAVendedorId;
    } else {
      ticketVendedorId = actorUserId;
    }
  } else {
    throw new TicketSellerNotAllowedError(
      "Rol no autorizado para emitir tickets.",
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
  // Compara Ticket.vendedorId (atribuido), no solo el actor.
  const existente = await db.ticket.findUnique({
    where: { idempotencyKey },
    include: includeLineas,
  });
  if (existente) {
    return resolverReplay({
      existing: existente,
      vendedorId: ticketVendedorId,
      requestHash,
    });
  }

  // Fast-fail fuera de TX (optimización). La autoridad es el FOR UPDATE dentro.
  await assertEmisorPuedeCrearTicket(db, {
    vendedorId: actorUserId,
    actorRol,
  });

  try {
    const ticket = await db.$transaction(
      async (tx) => {
      // Autoridad + orden de locks (compatible con setComisionVendedor):
      //   1) Usuario(actor) FOR UPDATE
      //   2) Usuario(atribuido) FOR UPDATE si ≠ actor
      //   3) VendedorComision(ticketVendor) FOR UPDATE (en maybeCreate…)
      //   4) VendedorCreditoCuenta(actor) FOR UPDATE (créditos)
      await lockAndAssertEmisorPuedeCrearTicket(tx, {
        vendedorId: actorUserId,
        actorRol,
      });
      if (options.afterEmisorLocked) {
        await options.afterEmisorLocked();
      }

      // Atribución ADMIN: bloquear al VENDEDOR atribuido (mismo orden que
      // setComision: Usuario(vend) antes de VendedorComision).
      if (ticketVendedorId !== actorUserId) {
        await lockAndAssertEmisorPuedeCrearTicket(tx, {
          vendedorId: ticketVendedorId,
          actorRol: "VENDEDOR",
        });
      }

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
          vendedorId: ticketVendedorId,
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
        usuarioId: actorUserId,
        accion: "CREAR_TICKET",
        entidad: "TICKET",
        entidadId: created.id,
        detalle: {
          numeroVisible: created.numeroVisible,
          totalApostado: created.totalApostado.toFixed(2),
          fechaJuego: fechaStr,
          ...(ticketVendedorId !== actorUserId
            ? { atribuidoAVendedorId: ticketVendedorId }
            : {}),
        },
      });

      // Caja C3: obligación en la misma TX (antes de créditos).
      // Fallo de obligación → rollback del ticket. Sin obligación huérfana.
      if (options.beforeCajaObligacion) {
        await options.beforeCajaObligacion();
      }
      await maybeCreateCajaObligacionEnTx(tx, {
        ticketId: created.id,
        ticketVendedorId,
        bruto: created.totalApostado,
        ticketCreatedAt: created.createdAt,
        actorUserId,
        actorAdminId: actorRol === "ADMIN" ? actorUserId : null,
        ahora,
      });
      if (options.afterCajaObligacion) {
        await options.afterCajaObligacion();
      }

      // Créditos: siempre el actor de sesión (no el atribuido).
      // ADMIN → skipped; VENDEDOR → consume de su propia cuenta.
      const creditsStore = bindCreditsStore(tx);
      await consumirCreditosTrasEmitirTicket(creditsStore, {
        actorRol,
        vendedorId: actorUserId,
        ticketId: created.id,
        ticketCreatedAt: created.createdAt,
        totalApostado: created.totalApostado,
        ahora,
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

    const race = await db.ticket.findUnique({
      where: { idempotencyKey },
      include: includeLineas,
    });
    if (!race) {
      throw error;
    }
    return resolverReplay({
      existing: race,
      vendedorId: ticketVendedorId,
      requestHash,
    });
  }
}
