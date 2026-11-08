import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { EstadoResultadoProgramado } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { fechaAYYYYMMDD, parseFechaYYYYMMDD } from "@/lib/fecha";
import {
  ATRASADOS_DEFAULT_LOOKBACK_DAYS,
  ATRASADOS_RANGE_DAYS_MAX,
  listSorteosAtrasados,
  parseListAtrasadosQuery,
  resolveInicioOperativo,
  type AtrasadosDb,
} from "@/lib/resultados/list-atrasados";
import {
  handleListAtrasadosRequest,
} from "@/lib/resultados/list-atrasados-http";

/** 2026-10-03 14:00 UTC = 10:00 America/Caracas → hoy VE = 2026-10-03 */
const AHORA = new Date(Date.UTC(2026, 9, 3, 14, 0, 0));
const HOY = "2026-10-03";
const AYER = "2026-10-02";
const ANTEAYER = "2026-10-01";
const FUTURO = "2026-10-04";

type ResultadoRow = { fecha: Date; hora: number };
type ProgramacionRow = {
  fecha: Date;
  hora: number;
  estado: EstadoResultadoProgramado;
  numero: string;
};

function d(fechaStr: string): Date {
  return parseFechaYYYYMMDD(fechaStr)!;
}

function makeDb(opts?: {
  resultados?: ResultadoRow[];
  programaciones?: ProgramacionRow[];
  tickets?: { fechaJuego: Date }[];
  writes?: { create: number; update: number; delete: number };
}): AtrasadosDb & {
  writes: { create: number; update: number; delete: number };
} {
  const writes = opts?.writes ?? { create: 0, update: 0, delete: 0 };
  const resultados = [...(opts?.resultados ?? [])];
  const programaciones = [...(opts?.programaciones ?? [])];
  const tickets = [...(opts?.tickets ?? [])];

  function forbidWrite(kind: "create" | "update" | "delete") {
    writes[kind] += 1;
    throw new Error(`escritura prohibida: ${kind}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultado: any = {
    async findMany(args: { where: { fecha: { gte: Date; lte: Date } } }) {
      return resultados.filter(
        (r) =>
          r.fecha.getTime() >= args.where.fecha.gte.getTime() &&
          r.fecha.getTime() <= args.where.fecha.lte.getTime(),
      );
    },
    async findFirst(args: { orderBy: { fecha: "asc" } }) {
      void args;
      if (resultados.length === 0) return null;
      const sorted = [...resultados].sort(
        (a, b) => a.fecha.getTime() - b.fecha.getTime(),
      );
      return { fecha: sorted[0]!.fecha };
    },
    create: () => forbidWrite("create"),
    update: () => forbidWrite("update"),
    delete: () => forbidWrite("delete"),
    updateMany: () => forbidWrite("update"),
    createMany: () => forbidWrite("create"),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultadoProgramado: any = {
    async findMany(args: { where: { fecha: { gte: Date; lte: Date } } }) {
      return programaciones.filter(
        (p) =>
          p.fecha.getTime() >= args.where.fecha.gte.getTime() &&
          p.fecha.getTime() <= args.where.fecha.lte.getTime(),
      );
    },
    async findFirst() {
      if (programaciones.length === 0) return null;
      const sorted = [...programaciones].sort(
        (a, b) => a.fecha.getTime() - b.fecha.getTime(),
      );
      return { fecha: sorted[0]!.fecha };
    },
    create: () => forbidWrite("create"),
    update: () => forbidWrite("update"),
    delete: () => forbidWrite("delete"),
    updateMany: () => forbidWrite("update"),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticket: any = {
    async findFirst() {
      if (tickets.length === 0) return null;
      const sorted = [...tickets].sort(
        (a, b) => a.fechaJuego.getTime() - b.fechaJuego.getTime(),
      );
      return { fechaJuego: sorted[0]!.fechaJuego };
    },
    create: () => forbidWrite("create"),
    update: () => forbidWrite("update"),
    delete: () => forbidWrite("delete"),
  };

  return { resultado, resultadoProgramado, ticket, writes };
}

describe("parseListAtrasadosQuery (America/Caracas)", () => {
  it("rechaza el día actual y fechas futuras", () => {
    assert.throws(
      () => parseListAtrasadosQuery({ desde: AYER, hasta: HOY }, AHORA),
      /día actual|futuras/i,
    );
    assert.throws(
      () => parseListAtrasadosQuery({ desde: AYER, hasta: FUTURO }, AHORA),
      /día actual|futuras/i,
    );
  });

  it("por defecto usa lookback hasta ayer Caracas", () => {
    const parsed = parseListAtrasadosQuery({}, AHORA, null);
    assert.equal(fechaAYYYYMMDD(parsed.hasta), AYER);
    assert.equal(
      fechaAYYYYMMDD(parsed.desde),
      fechaAYYYYMMDD(
        d(
          // hasta - (lookback-1)
          "2026-09-26",
        ),
      ),
    );
    assert.equal(ATRASADOS_DEFAULT_LOOKBACK_DAYS, 7);
  });

  it("limita el tamaño del intervalo", () => {
    assert.throws(
      () =>
        parseListAtrasadosQuery(
          { desde: "2026-07-01", hasta: AYER },
          AHORA,
        ),
      new RegExp(String(ATRASADOS_RANGE_DAYS_MAX)),
    );
  });
});

describe("listSorteosAtrasados — detección de solo lectura", () => {
  it("1) una franja de ayer sin resultado aparece", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(ANTEAYER) }],
      resultados: [
        // Solo hora 9 publicada ayer; 10–19 faltan
        { fecha: d(AYER), hora: 9 },
      ],
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    assert.ok(result.items.some((i) => i.fecha === AYER && i.hora === 10));
    assert.equal(
      result.items.find((i) => i.hora === 9),
      undefined,
    );
    assert.equal(result.resumen.totalSinResultado, 10);
  });

  it("2) una franja de ayer con resultado no aparece", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      resultados: HORAS_ALL_PUBLISHED(AYER),
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.resumen.totalSinResultado, 0);
  });

  it("3) PENDIENTE antigua aparece identificada y no se publica", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      programaciones: [
        {
          fecha: d(AYER),
          hora: 11,
          estado: "PENDIENTE",
          numero: "07",
        },
      ],
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    const slot = result.items.find((i) => i.hora === 11);
    assert.ok(slot);
    assert.equal(slot.tieneProgramacionPendiente, true);
    assert.equal(slot.programacion?.estado, "PENDIENTE");
    assert.equal(slot.programacion?.numero, "07");
    assert.equal(slot.requiereIntervencionAdmin, true);
    assert.equal(db.writes.create, 0);
    assert.equal(db.writes.update, 0);
  });

  it("4) PUBLICADO en programación sin Resultado no cuenta como publicado", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      programaciones: [
        {
          fecha: d(AYER),
          hora: 12,
          estado: "PUBLICADO",
          numero: "15",
        },
      ],
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    const slot = result.items.find((i) => i.hora === 12);
    assert.ok(slot, "debe aparecer: la fuente de verdad es Resultado");
    assert.equal(slot.tieneResultado, false);
    assert.equal(slot.programacion?.estado, "PUBLICADO");
    assert.equal(slot.tieneProgramacionPendiente, false);
  });

  it("5) el día actual no aparece en el listado histórico", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    assert.equal(
      result.items.some((i) => i.fecha === HOY),
      false,
    );
    assert.equal(result.rango.hasta, AYER);
  });

  it("6) fechas futuras no aparecen", async () => {
    assert.throws(
      () =>
        parseListAtrasadosQuery(
          { desde: FUTURO, hasta: FUTURO },
          AHORA,
        ),
      /futuras|día actual/i,
    );
  });

  it("7) la zona horaria del corte es America/Caracas", async () => {
    // 2026-10-03 03:30 UTC = 2026-10-02 23:30 Caracas → hoy VE = 02
    const nocheVe = new Date(Date.UTC(2026, 9, 3, 3, 30, 0));
    const parsed = parseListAtrasadosQuery({}, nocheVe, null);
    assert.equal(fechaAYYYYMMDD(parsed.hasta), "2026-10-01");
  });

  it("8) paginación e intervalos funcionan", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(ANTEAYER) }],
    });
    const page1 = await listSorteosAtrasados(
      db,
      { desde: ANTEAYER, hasta: AYER, page: 1, pageSize: 11 },
      AHORA,
    );
    assert.equal(page1.total, 22);
    assert.equal(page1.items.length, 11);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.rango.desde, ANTEAYER);
    assert.equal(page1.rango.hasta, AYER);
    assert.equal(page1.items[0]?.fecha, ANTEAYER);
    assert.equal(page1.items[0]?.hora, 9);

    const page2 = await listSorteosAtrasados(
      db,
      { desde: ANTEAYER, hasta: AYER, page: 2, pageSize: 11 },
      AHORA,
    );
    assert.equal(page2.items.length, 11);
    assert.equal(page2.items[0]?.fecha, AYER);
    assert.equal(page2.items[0]?.hora, 9);
  });

  it("10) la consulta no ejecuta servicios de publicación ni escrituras", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      resultados: [{ fecha: d(AYER), hora: 9 }],
    });
    await listSorteosAtrasados(db, { desde: AYER, hasta: AYER }, AHORA);
    assert.equal(db.writes.create, 0);
    assert.equal(db.writes.update, 0);
    assert.equal(db.writes.delete, 0);

    const autoPublishSrc = readFileSync(
      path.join(process.cwd(), "lib/resultados/list-atrasados.ts"),
      "utf8",
    );
    assert.equal(
      /import[\s\S]*runAutomaticResultsPublish/.test(autoPublishSrc),
      false,
    );
    assert.equal(
      /import[\s\S]*tryCreateAutomaticResult/.test(autoPublishSrc),
      false,
    );
    assert.equal(
      /import[\s\S]*createManualResult/.test(autoPublishSrc),
      false,
    );
    assert.equal(
      /import[\s\S]*pickRandomAnimalNumero/.test(autoPublishSrc),
      false,
    );
    assert.equal(autoPublishSrc.includes("$transaction"), false);
    assert.equal(autoPublishSrc.includes("resultado.create"), false);
  });

  it("11) consulta vacía (todo publicado) sin incidencias", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      resultados: HORAS_ALL_PUBLISHED(AYER),
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER },
      AHORA,
    );
    assert.equal(result.total, 0);
    assert.equal(result.totalPages, 0);
    assert.deepEqual(result.resumen, {
      totalSinResultado: 0,
      totalConProgramacionPendiente: 0,
      totalSinProgramacionPendiente: 0,
    });
  });

  it("12) el resumen coincide con el listado filtrado completo", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      resultados: [
        { fecha: d(AYER), hora: 9 },
        { fecha: d(AYER), hora: 10 },
      ],
      programaciones: [
        {
          fecha: d(AYER),
          hora: 11,
          estado: "PENDIENTE",
          numero: "03",
        },
        {
          fecha: d(AYER),
          hora: 12,
          estado: "PENDIENTE",
          numero: "05",
        },
      ],
    });
    const result = await listSorteosAtrasados(
      db,
      { desde: AYER, hasta: AYER, page: 1, pageSize: 3 },
      AHORA,
    );
    assert.equal(result.resumen.totalSinResultado, 9);
    assert.equal(result.resumen.totalConProgramacionPendiente, 2);
    assert.equal(result.resumen.totalSinProgramacionPendiente, 7);
    assert.equal(result.items.length, 3);
    assert.equal(
      result.resumen.totalSinResultado,
      result.resumen.totalConProgramacionPendiente +
        result.resumen.totalSinProgramacionPendiente,
    );
  });

  it("inicio operativo sale de datos reales, no inventado", async () => {
    const db = makeDb({
      resultados: [{ fecha: d("2026-09-20"), hora: 9 }],
      tickets: [{ fechaJuego: d("2026-09-15") }],
    });
    const inicio = await resolveInicioOperativo(db);
    assert.equal(fechaAYYYYMMDD(inicio!), "2026-09-15");
  });
});

function HORAS_ALL_PUBLISHED(fechaStr: string): ResultadoRow[] {
  return [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((hora) => ({
    fecha: d(fechaStr),
    hora,
  }));
}

describe("HTTP listado atrasados — auth y solo lectura", () => {
  it("9) VENDEDOR recibe 403 y ADMIN puede consultar", async () => {
    const db = makeDb({
      tickets: [{ fechaJuego: d(AYER) }],
      resultados: HORAS_ALL_PUBLISHED(AYER),
    });

    const vendor = await handleListAtrasadosRequest(
      new Request(
        `http://local/api/admin/resultados/atrasados?desde=${AYER}&hasta=${AYER}`,
      ),
      {
        requireAdmin: async () => {
          throw new ForbiddenError("Se requiere rol ADMIN.");
        },
        list: (q) => listSorteosAtrasados(db, q, AHORA),
      },
    );
    assert.equal(vendor.status, 403);
    const vendorBody = await vendor.json();
    assert.equal(vendorBody.ok, false);
    assert.equal(vendorBody.error.code, "FORBIDDEN");

    const admin = await handleListAtrasadosRequest(
      new Request(
        `http://local/api/admin/resultados/atrasados?desde=${AYER}&hasta=${AYER}`,
      ),
      {
        requireAdmin: async () =>
          ({
            userId: "admin-1",
            source: "session",
            user: { id: "admin-1", rol: "ADMIN" },
          }) as never,
        list: (q) => listSorteosAtrasados(db, q, AHORA),
      },
    );
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get("Cache-Control"), "no-store");
    const adminBody = await admin.json();
    assert.equal(adminBody.ok, true);
    assert.equal(adminBody.total, 0);

    const routeSrc = readFileSync(
      path.join(
        process.cwd(),
        "app/api/admin/resultados/atrasados/route.ts",
      ),
      "utf8",
    );
    assert.match(routeSrc, /requireAdmin/);
    const httpSrc = readFileSync(
      path.join(process.cwd(), "lib/resultados/list-atrasados-http.ts"),
      "utf8",
    );
    assert.match(httpSrc, /Cache-Control/);
    assert.match(httpSrc, /no-store/);
  });
});
