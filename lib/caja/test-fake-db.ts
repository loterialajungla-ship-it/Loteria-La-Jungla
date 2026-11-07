/**
 * Fake in-memory para unit tests de Caja (sin DB real).
 */
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

type UserRow = {
  id: string;
  rol: "ADMIN" | "VENDEDOR";
  activo: boolean;
  nombre?: string;
  usuario?: string;
};

type ComisionRow = {
  vendedorId: string;
  porcentaje: Prisma.Decimal;
  updatedAt: Date;
  updatedByAdminId: string | null;
};

type HistorialRow = {
  id: string;
  vendedorId: string;
  porcentajeAnterior: Prisma.Decimal | null;
  porcentajeNuevo: Prisma.Decimal;
  changedAt: Date;
  changedByAdminId: string | null;
  motivo: string | null;
};

type CajaConfigRow = {
  id: number;
  activa: boolean;
  activadaEn: Date | null;
  activadaPorAdminId: string | null;
  updatedAt: Date;
};

type ObligacionRow = {
  id: string;
  ticketId: string;
  vendedorId: string;
  bruto: Prisma.Decimal;
  comisionPorcentaje: Prisma.Decimal;
  comisionImporte: Prisma.Decimal;
  importeAdmin: Prisma.Decimal;
  createdAt: Date;
  /** Para FIFO en fake (simula Ticket.createdAt). */
  ticketCreatedAt: Date;
};

type AplicacionRow = {
  id: string;
  confirmacionId: string;
  obligacionId: string;
  vendedorId: string;
  importeAplicado: Prisma.Decimal;
  createdAt: Date;
};

type DeclaracionRow = {
  id: string;
  vendedorId: string;
  importeDeclarado: Prisma.Decimal;
  declaradoAt: Date;
  idempotencyKey: string;
  idempotencyRequestHash: string | null;
  nota: string | null;
};

type ConfirmacionRow = {
  id: string;
  declaracionId: string;
  importeConfirmado: Prisma.Decimal;
  confirmadoPorAdminId: string;
  confirmadoAt: Date;
  idempotencyKey: string;
  idempotencyRequestHash: string | null;
};

function p2002(target: string[]): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });
}

export function makeCajaFakeDb(opts?: { users?: UserRow[] }) {
  const users = new Map<string, UserRow>();
  for (const u of opts?.users ?? []) {
    users.set(u.id, { ...u });
  }
  const comisiones = new Map<string, ComisionRow>();
  const historial: HistorialRow[] = [];
  let cajaConfig: CajaConfigRow | null = null;
  const auditRows: unknown[] = [];
  const obligaciones = new Map<string, ObligacionRow>();
  const obligacionesByTicket = new Map<string, string>();
  const declaraciones = new Map<string, DeclaracionRow>();
  const declaracionesByIdem = new Map<string, string>();
  const confirmaciones = new Map<string, ConfirmacionRow>();
  const confirmacionesByIdem = new Map<string, string>();
  const aplicaciones = new Map<string, AplicacionRow>();
  const aplicacionPair = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    users,
    historial,
    auditRows,
    obligaciones,
    declaraciones,
    confirmaciones,
    aplicaciones,
    get comisiones() {
      return comisiones;
    },
    usuario: {
      async findUnique(args: { where: { id: string }; select?: unknown }) {
        const u = users.get(args.where.id);
        if (!u) return null;
        return {
          id: u.id,
          rol: u.rol,
          activo: u.activo,
          nombre: u.nombre ?? u.id,
          usuario: u.usuario ?? u.id,
        };
      },
      async findMany(args: {
        where?: { rol?: string };
        select?: unknown;
        orderBy?: unknown;
      }) {
        let list = [...users.values()];
        if (args.where?.rol) {
          list = list.filter((u) => u.rol === args.where!.rol);
        }
        list.sort((a, b) =>
          (a.usuario ?? a.id).localeCompare(b.usuario ?? b.id),
        );
        return list.map((u) => ({
          id: u.id,
          nombre: u.nombre ?? u.id,
          usuario: u.usuario ?? u.id,
          rol: u.rol,
          activo: u.activo,
        }));
      },
    },
    cajaConfig: {
      async findUnique(args: { where: { id: number } }) {
        if (args.where.id !== 1) return null;
        return cajaConfig ? { ...cajaConfig } : null;
      },
      async create(args: { data: CajaConfigRow }) {
        cajaConfig = { ...args.data };
        return { ...cajaConfig };
      },
      async update(args: {
        where: { id: number };
        data: Partial<CajaConfigRow>;
      }) {
        if (!cajaConfig || args.where.id !== 1) {
          throw new Error("CajaConfig missing");
        }
        cajaConfig = { ...cajaConfig, ...args.data, id: 1 };
        return { ...cajaConfig };
      },
    },
    vendedorComision: {
      async findUnique(args: { where: { vendedorId: string } }) {
        const row = comisiones.get(args.where.vendedorId);
        return row ? { ...row } : null;
      },
      async create(args: { data: ComisionRow }) {
        if (comisiones.has(args.data.vendedorId)) {
          const err = new Error("Unique") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        const row = {
          ...args.data,
          porcentaje: new Prisma.Decimal(args.data.porcentaje),
        };
        comisiones.set(row.vendedorId, row);
        return { ...row };
      },
      async update(args: {
        where: { vendedorId: string };
        data: Partial<ComisionRow>;
      }) {
        const cur = comisiones.get(args.where.vendedorId);
        if (!cur) throw new Error("missing comision");
        const next = {
          ...cur,
          ...args.data,
          porcentaje: new Prisma.Decimal(
            args.data.porcentaje ?? cur.porcentaje,
          ),
        };
        comisiones.set(args.where.vendedorId, next);
        return { ...next };
      },
    },
    vendedorComisionHistorial: {
      async create(args: {
        data: {
          id?: string;
          vendedorId: string;
          porcentajeAnterior: Prisma.Decimal | null;
          porcentajeNuevo: Prisma.Decimal;
          changedAt: Date;
          changedByAdminId: string | null;
          motivo: string | null;
        };
      }) {
        const row: HistorialRow = {
          id: args.data.id ?? `vch_${randomBytes(8).toString("hex")}`,
          vendedorId: args.data.vendedorId,
          porcentajeAnterior:
            args.data.porcentajeAnterior == null
              ? null
              : new Prisma.Decimal(args.data.porcentajeAnterior),
          porcentajeNuevo: new Prisma.Decimal(args.data.porcentajeNuevo),
          changedAt: args.data.changedAt,
          changedByAdminId: args.data.changedByAdminId,
          motivo: args.data.motivo,
        };
        historial.push(row);
        return { ...row };
      },
      async findMany(args: {
        where: { vendedorId: string };
        orderBy?: unknown;
      }) {
        return historial
          .filter((h) => h.vendedorId === args.where.vendedorId)
          .slice()
          .sort(
            (a, b) =>
              a.changedAt.getTime() - b.changedAt.getTime() ||
              a.id.localeCompare(b.id),
          )
          .map((h) => ({ ...h }));
      },
    },
    cajaObligacion: {
      async findUnique(args: {
        where: { ticketId?: string; id?: string };
      }) {
        if (args.where.ticketId) {
          const oid = obligacionesByTicket.get(args.where.ticketId);
          if (!oid) return null;
          const row = obligaciones.get(oid);
          return row ? { ...row } : null;
        }
        if (args.where.id) {
          const row = obligaciones.get(args.where.id);
          return row ? { ...row } : null;
        }
        return null;
      },
      async create(args: {
        data: {
          id: string;
          ticketId: string;
          vendedorId: string;
          bruto: Prisma.Decimal;
          comisionPorcentaje: Prisma.Decimal;
          comisionImporte: Prisma.Decimal;
          importeAdmin: Prisma.Decimal;
          createdAt?: Date;
          ticketCreatedAt?: Date;
        };
      }) {
        if (obligacionesByTicket.has(args.data.ticketId)) {
          const err = Object.assign(new Error("Unique ticketId"), {
            code: "P2002",
            meta: { target: ["ticketId"] },
          });
          throw err;
        }
        const createdAt = args.data.createdAt ?? new Date();
        const row: ObligacionRow = {
          id: args.data.id,
          ticketId: args.data.ticketId,
          vendedorId: args.data.vendedorId,
          bruto: new Prisma.Decimal(args.data.bruto),
          comisionPorcentaje: new Prisma.Decimal(args.data.comisionPorcentaje),
          comisionImporte: new Prisma.Decimal(args.data.comisionImporte),
          importeAdmin: new Prisma.Decimal(args.data.importeAdmin),
          createdAt,
          ticketCreatedAt: args.data.ticketCreatedAt ?? createdAt,
        };
        obligaciones.set(row.id, row);
        obligacionesByTicket.set(row.ticketId, row.id);
        return { ...row };
      },
      async findMany(args?: {
        where?: { vendedorId?: string };
        orderBy?: unknown;
      }) {
        let list = [...obligaciones.values()];
        if (args?.where?.vendedorId) {
          list = list.filter((o) => o.vendedorId === args.where!.vendedorId);
        }
        list.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.ticketId.localeCompare(b.ticketId),
        );
        return list.map((o) => ({ ...o }));
      },
      async aggregate(args: {
        where?: { vendedorId?: string };
        _sum?: {
          importeAdmin?: boolean;
          bruto?: boolean;
          comisionImporte?: boolean;
        };
      }) {
        let list = [...obligaciones.values()];
        if (args.where?.vendedorId) {
          list = list.filter((o) => o.vendedorId === args.where!.vendedorId);
        }
        let importeAdmin = new Prisma.Decimal(0);
        let bruto = new Prisma.Decimal(0);
        let comisionImporte = new Prisma.Decimal(0);
        for (const o of list) {
          importeAdmin = importeAdmin.plus(o.importeAdmin);
          bruto = bruto.plus(o.bruto);
          comisionImporte = comisionImporte.plus(o.comisionImporte);
        }
        const empty = list.length === 0;
        return {
          _sum: {
            importeAdmin: empty ? null : importeAdmin,
            bruto: empty ? null : bruto,
            comisionImporte: empty ? null : comisionImporte,
          },
        };
      },
    },
    cajaDeclaracion: {
      async findUnique(args: {
        where: { id?: string; idempotencyKey?: string };
      }) {
        if (args.where.idempotencyKey) {
          const id = declaracionesByIdem.get(args.where.idempotencyKey);
          if (!id) return null;
          const row = declaraciones.get(id);
          return row ? { ...row } : null;
        }
        if (args.where.id) {
          const row = declaraciones.get(args.where.id);
          return row ? { ...row } : null;
        }
        return null;
      },
      async create(args: {
        data: {
          id: string;
          vendedorId: string;
          importeDeclarado: Prisma.Decimal;
          declaradoAt?: Date;
          idempotencyKey: string;
          idempotencyRequestHash?: string | null;
          nota?: string | null;
        };
      }) {
        if (declaracionesByIdem.has(args.data.idempotencyKey)) {
          throw p2002(["idempotencyKey"]);
        }
        const row: DeclaracionRow = {
          id: args.data.id,
          vendedorId: args.data.vendedorId,
          importeDeclarado: new Prisma.Decimal(args.data.importeDeclarado),
          declaradoAt: args.data.declaradoAt ?? new Date(),
          idempotencyKey: args.data.idempotencyKey,
          idempotencyRequestHash: args.data.idempotencyRequestHash ?? null,
          nota: args.data.nota ?? null,
        };
        declaraciones.set(row.id, row);
        declaracionesByIdem.set(row.idempotencyKey, row.id);
        return { ...row };
      },
      async findMany(args?: {
        where?: { vendedorId?: string };
        orderBy?: unknown;
        include?: { confirmaciones?: unknown };
        select?: { id?: boolean };
      }) {
        let list = [...declaraciones.values()];
        if (args?.where?.vendedorId) {
          list = list.filter((d) => d.vendedorId === args.where!.vendedorId);
        }
        list.sort(
          (a, b) =>
            a.declaradoAt.getTime() - b.declaradoAt.getTime() ||
            a.id.localeCompare(b.id),
        );
        if (args?.select?.id) {
          return list.map((d) => ({ id: d.id }));
        }
        if (args?.include?.confirmaciones) {
          return list.map((d) => ({
            ...d,
            confirmaciones: [...confirmaciones.values()]
              .filter((c) => c.declaracionId === d.id)
              .sort(
                (a, b) =>
                  a.confirmadoAt.getTime() - b.confirmadoAt.getTime() ||
                  a.id.localeCompare(b.id),
              )
              .map((c) => ({ ...c })),
          }));
        }
        return list.map((d) => ({ ...d }));
      },
      async aggregate(args: {
        where?: { vendedorId?: string };
        _sum?: { importeDeclarado?: boolean };
      }) {
        let list = [...declaraciones.values()];
        if (args.where?.vendedorId) {
          list = list.filter((d) => d.vendedorId === args.where!.vendedorId);
        }
        let sum = new Prisma.Decimal(0);
        for (const d of list) sum = sum.plus(d.importeDeclarado);
        return { _sum: { importeDeclarado: list.length ? sum : null } };
      },
    },
    cajaConfirmacion: {
      async findUnique(args: {
        where: { id?: string; idempotencyKey?: string };
      }) {
        if (args.where.idempotencyKey) {
          const id = confirmacionesByIdem.get(args.where.idempotencyKey);
          if (!id) return null;
          const row = confirmaciones.get(id);
          return row ? { ...row } : null;
        }
        if (args.where.id) {
          const row = confirmaciones.get(args.where.id);
          return row ? { ...row } : null;
        }
        return null;
      },
      async create(args: {
        data: {
          id: string;
          declaracionId: string;
          importeConfirmado: Prisma.Decimal;
          confirmadoPorAdminId: string;
          confirmadoAt?: Date;
          idempotencyKey: string;
          idempotencyRequestHash?: string | null;
        };
      }) {
        if (confirmacionesByIdem.has(args.data.idempotencyKey)) {
          throw p2002(["idempotencyKey"]);
        }
        const row: ConfirmacionRow = {
          id: args.data.id,
          declaracionId: args.data.declaracionId,
          importeConfirmado: new Prisma.Decimal(args.data.importeConfirmado),
          confirmadoPorAdminId: args.data.confirmadoPorAdminId,
          confirmadoAt: args.data.confirmadoAt ?? new Date(),
          idempotencyKey: args.data.idempotencyKey,
          idempotencyRequestHash: args.data.idempotencyRequestHash ?? null,
        };
        confirmaciones.set(row.id, row);
        confirmacionesByIdem.set(row.idempotencyKey, row.id);
        return { ...row };
      },
      async aggregate(args: {
        where?: {
          declaracionId?: string | { in: string[] };
        };
        _sum?: { importeConfirmado?: boolean };
      }) {
        let list = [...confirmaciones.values()];
        const w = args.where?.declaracionId;
        if (typeof w === "string") {
          list = list.filter((c) => c.declaracionId === w);
        } else if (w && typeof w === "object" && Array.isArray(w.in)) {
          const set = new Set(w.in);
          list = list.filter((c) => set.has(c.declaracionId));
        }
        let sum = new Prisma.Decimal(0);
        for (const c of list) sum = sum.plus(c.importeConfirmado);
        return { _sum: { importeConfirmado: list.length ? sum : null } };
      },
    },
    cajaAplicacion: {
      async findMany(args?: {
        where?: {
          confirmacionId?: string;
          obligacionId?: string;
          vendedorId?: string;
        };
        orderBy?: unknown;
      }) {
        let list = [...aplicaciones.values()];
        if (args?.where?.confirmacionId) {
          list = list.filter(
            (a) => a.confirmacionId === args.where!.confirmacionId,
          );
        }
        if (args?.where?.obligacionId) {
          list = list.filter(
            (a) => a.obligacionId === args.where!.obligacionId,
          );
        }
        if (args?.where?.vendedorId) {
          list = list.filter((a) => a.vendedorId === args.where!.vendedorId);
        }
        list.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
        return list.map((a) => ({ ...a }));
      },
      async create(args: {
        data: {
          id: string;
          confirmacionId: string;
          obligacionId: string;
          vendedorId: string;
          importeAplicado: Prisma.Decimal;
          createdAt?: Date;
        };
      }) {
        const pair = `${args.data.confirmacionId}::${args.data.obligacionId}`;
        if (aplicacionPair.has(pair)) {
          throw p2002(["confirmacionId", "obligacionId"]);
        }
        const conf = confirmaciones.get(args.data.confirmacionId);
        const obl = obligaciones.get(args.data.obligacionId);
        if (!conf || !obl) {
          throw new Error("FK aplicacion");
        }
        const decl = declaraciones.get(conf.declaracionId);
        if (!decl || decl.vendedorId !== obl.vendedorId) {
          throw new Error("CajaAplicacion: vendedor mismatch");
        }
        if (args.data.vendedorId !== obl.vendedorId) {
          throw new Error("CajaAplicacion: vendedorId inconsistente");
        }
        const importe = new Prisma.Decimal(args.data.importeAplicado);
        if (importe.lte(0)) throw new Error("importeAplicado <= 0");
        let sumConf = new Prisma.Decimal(0);
        let sumObl = new Prisma.Decimal(0);
        for (const a of aplicaciones.values()) {
          if (a.confirmacionId === args.data.confirmacionId) {
            sumConf = sumConf.plus(a.importeAplicado);
          }
          if (a.obligacionId === args.data.obligacionId) {
            sumObl = sumObl.plus(a.importeAplicado);
          }
        }
        if (sumConf.plus(importe).gt(conf.importeConfirmado)) {
          throw new Error("CajaAplicacion: suma supera importeConfirmado");
        }
        if (sumObl.plus(importe).gt(obl.importeAdmin)) {
          throw new Error("CajaAplicacion: suma supera importeAdmin");
        }
        const row: AplicacionRow = {
          id: args.data.id,
          confirmacionId: args.data.confirmacionId,
          obligacionId: args.data.obligacionId,
          vendedorId: args.data.vendedorId,
          importeAplicado: importe,
          createdAt: args.data.createdAt ?? new Date(),
        };
        aplicaciones.set(row.id, row);
        aplicacionPair.add(pair);
        return { ...row };
      },
      async aggregate(args: {
        where?: {
          confirmacionId?: string;
          obligacionId?: string;
          vendedorId?: string;
        };
        _sum?: { importeAplicado?: boolean };
      }) {
        let list = [...aplicaciones.values()];
        if (args.where?.confirmacionId) {
          list = list.filter(
            (a) => a.confirmacionId === args.where!.confirmacionId,
          );
        }
        if (args.where?.obligacionId) {
          list = list.filter(
            (a) => a.obligacionId === args.where!.obligacionId,
          );
        }
        if (args.where?.vendedorId) {
          list = list.filter((a) => a.vendedorId === args.where!.vendedorId);
        }
        let sum = new Prisma.Decimal(0);
        for (const a of list) sum = sum.plus(a.importeAplicado);
        return { _sum: { importeAplicado: list.length ? sum : null } };
      },
    },
    auditoria: {
      async create(args: { data: unknown }) {
        auditRows.push(args.data);
        return {};
      },
    },
    async $queryRaw(...args: unknown[]) {
      const sql = args[0] as { strings?: readonly string[] } | undefined;
      const text = Array.isArray(sql?.strings)
        ? sql!.strings!.join(" ")
        : String(sql ?? "");
      const id = typeof args[1] === "string" ? args[1] : "";
      if (text.includes('"Usuario"') && text.includes("FOR UPDATE")) {
        const u = users.get(id);
        if (!u) return [];
        return [{ id: u.id, rol: u.rol, activo: u.activo }];
      }
      if (text.includes('"VendedorComision"') && text.includes("FOR UPDATE")) {
        const row = comisiones.get(id);
        if (!row) return [];
        return [
          {
            vendedorId: row.vendedorId,
            porcentaje: row.porcentaje,
            updatedAt: row.updatedAt,
            updatedByAdminId: row.updatedByAdminId,
          },
        ];
      }
      if (text.includes('"CajaDeclaracion"') && text.includes("FOR UPDATE")) {
        const row = declaraciones.get(id);
        if (!row) return [];
        return [
          {
            id: row.id,
            vendedorId: row.vendedorId,
            importeDeclarado: row.importeDeclarado,
            declaradoAt: row.declaradoAt,
            nota: row.nota,
          },
        ];
      }
      if (
        text.includes('"CajaConfirmacion"') &&
        text.includes("FOR UPDATE") &&
        !text.includes('"CajaObligacion"')
      ) {
        const row = confirmaciones.get(id);
        if (!row) return [];
        return [
          { id: row.id, importeConfirmado: row.importeConfirmado },
        ];
      }
      if (
        text.includes('"CajaObligacion"') &&
        text.includes('"Ticket"') &&
        (text.includes("FOR UPDATE") || text.includes("ORDER BY"))
      ) {
        const list = [...obligaciones.values()]
          .filter((o) => o.vendedorId === id)
          .sort(
            (a, b) =>
              a.ticketCreatedAt.getTime() - b.ticketCreatedAt.getTime() ||
              a.ticketId.localeCompare(b.ticketId),
          );
        return list.map((o) => ({
          id: o.id,
          ticketId: o.ticketId,
          vendedorId: o.vendedorId,
          importeAdmin: o.importeAdmin,
          ticketCreatedAt: o.ticketCreatedAt,
        }));
      }
      return [];
    },
    async $transaction<T>(fn: (tx: typeof api) => Promise<T>): Promise<T> {
      const snap = {
        obligaciones: new Map(obligaciones),
        obligacionesByTicket: new Map(obligacionesByTicket),
        declaraciones: new Map(declaraciones),
        declaracionesByIdem: new Map(declaracionesByIdem),
        confirmaciones: new Map(confirmaciones),
        confirmacionesByIdem: new Map(confirmacionesByIdem),
        aplicaciones: new Map(aplicaciones),
        aplicacionPair: new Set(aplicacionPair),
        auditLen: auditRows.length,
      };
      try {
        return await fn(api);
      } catch (error) {
        obligaciones.clear();
        for (const [k, v] of snap.obligaciones) obligaciones.set(k, v);
        obligacionesByTicket.clear();
        for (const [k, v] of snap.obligacionesByTicket) {
          obligacionesByTicket.set(k, v);
        }
        declaraciones.clear();
        for (const [k, v] of snap.declaraciones) declaraciones.set(k, v);
        declaracionesByIdem.clear();
        for (const [k, v] of snap.declaracionesByIdem) {
          declaracionesByIdem.set(k, v);
        }
        confirmaciones.clear();
        for (const [k, v] of snap.confirmaciones) confirmaciones.set(k, v);
        confirmacionesByIdem.clear();
        for (const [k, v] of snap.confirmacionesByIdem) {
          confirmacionesByIdem.set(k, v);
        }
        aplicaciones.clear();
        for (const [k, v] of snap.aplicaciones) aplicaciones.set(k, v);
        aplicacionPair.clear();
        for (const p of snap.aplicacionPair) aplicacionPair.add(p);
        auditRows.length = snap.auditLen;
        throw error;
      }
    },
  };

  return api;
}
