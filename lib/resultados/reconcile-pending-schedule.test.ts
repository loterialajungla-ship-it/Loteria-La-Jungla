import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EstadoResultadoProgramado } from "@prisma/client";
import { reconcilePendingScheduleForPublishedSlot } from "@/lib/resultados/reconcile-pending-schedule";

const FECHA = new Date(Date.UTC(2026, 9, 25));

type Sch = {
  id: string;
  fecha: Date;
  hora: number;
  numero: string;
  estado: EstadoResultadoProgramado;
  resultadoId: string | null;
};

describe("reconcilePendingScheduleForPublishedSlot", () => {
  it("mismo número → PUBLICADO + resultadoId", async () => {
    const schedules: Sch[] = [
      {
        id: "sch-1",
        fecha: FECHA,
        hora: 10,
        numero: "20",
        estado: "PENDIENTE",
        resultadoId: null,
      },
    ];
    const db = {
      resultadoProgramado: {
        async updateMany(args: {
          where: {
            fecha: Date;
            hora: number;
            estado: string;
            numero?: string;
          };
          data: { estado: EstadoResultadoProgramado; resultadoId?: string };
        }) {
          let count = 0;
          for (const row of schedules) {
            if (
              row.fecha.getTime() !== args.where.fecha.getTime() ||
              row.hora !== args.where.hora ||
              row.estado !== args.where.estado
            ) {
              continue;
            }
            if (
              args.where.numero !== undefined &&
              row.numero !== args.where.numero
            ) {
              continue;
            }
            row.estado = args.data.estado;
            if (args.data.resultadoId !== undefined) {
              row.resultadoId = args.data.resultadoId;
            }
            count += 1;
          }
          return { count };
        },
      },
    };

    const r = await reconcilePendingScheduleForPublishedSlot(db as never, {
      fecha: FECHA,
      hora: 10,
      resultadoId: "res-1",
      numero: "20",
    });
    assert.equal(r.linked, true);
    assert.equal(schedules[0]!.estado, "PUBLICADO");
    assert.equal(schedules[0]!.resultadoId, "res-1");
  });

  it("número distinto → SUPERSEDED", async () => {
    const schedules: Sch[] = [
      {
        id: "sch-1",
        fecha: FECHA,
        hora: 10,
        numero: "03",
        estado: "PENDIENTE",
        resultadoId: null,
      },
    ];
    const db = {
      resultadoProgramado: {
        async updateMany(args: {
          where: {
            fecha: Date;
            hora: number;
            estado: string;
            numero?: string;
          };
          data: { estado: EstadoResultadoProgramado; resultadoId?: string };
        }) {
          let count = 0;
          for (const row of schedules) {
            if (
              row.fecha.getTime() !== args.where.fecha.getTime() ||
              row.hora !== args.where.hora ||
              row.estado !== args.where.estado
            ) {
              continue;
            }
            if (
              args.where.numero !== undefined &&
              row.numero !== args.where.numero
            ) {
              continue;
            }
            row.estado = args.data.estado;
            count += 1;
          }
          return { count };
        },
      },
    };

    const r = await reconcilePendingScheduleForPublishedSlot(db as never, {
      fecha: FECHA,
      hora: 10,
      resultadoId: "res-1",
      numero: "20",
    });
    assert.equal(r.linked, false);
    assert.equal(r.superseded, true);
    assert.equal(schedules[0]!.estado, "SUPERSEDED");
  });
});
