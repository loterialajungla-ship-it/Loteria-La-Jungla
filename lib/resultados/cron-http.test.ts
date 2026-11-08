import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutoPublishRunResult } from "@/lib/resultados/auto-publish";
import { authorizeCronRequest } from "@/lib/resultados/cron-auth";
import {
  handleAutomaticResultsRequest,
  statusForAutomaticPublish,
} from "@/lib/resultados/cron-http";

const SECRET = "cron-http-test-secret";

function run(partial: Partial<AutoPublishRunResult> = {}): AutoPublishRunResult {
  const failed = partial.failed ?? 0;
  const processed = partial.processed ?? 2;
  return {
    ok: partial.ok ?? failed === 0,
    processed,
    slotsAttempted: partial.slotsAttempted ?? processed,
    created: partial.created ?? 1,
    skippedExists: partial.skippedExists ?? 1,
    failed,
    results: partial.results ?? [
      {
        status: "created",
        fecha: "2026-10-02",
        hora: 9,
        numero: "03",
        resultadoId: "res-9",
        origen: "AUTOMATICO",
        durationMs: 12,
      },
      {
        status: "skipped_exists",
        fecha: "2026-10-02",
        hora: 10,
        numero: "05",
        origen: "MANUAL",
        durationMs: 3,
      },
    ],
    catalogSize: 38,
    at: "2026-10-02T14:00:00.000Z",
    durationTotalMs: partial.durationTotalMs ?? 40,
  };
}

function authedRequest() {
  return new Request("http://local/api/cron/resultados-automaticos", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe("HTTP del cron de resultados automáticos", () => {
  it("sin fallos responde 200 y ok true", async () => {
    const body = run({ failed: 0, ok: true });
    assert.equal(statusForAutomaticPublish(body), 200);
    const response = await handleAutomaticResultsRequest(authedRequest(), {
      authorize: (request) =>
        authorizeCronRequest(request, { CRON_SECRET: SECRET }),
      publish: async () => body,
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.equal(json.failed, 0);
    assert.equal(json.results.length, 2);
    assert.equal(json.results[1].status, "skipped_exists");
  });

  it("un fallo parcial responde 500 y conserva el detalle", async () => {
    const body = run({
      ok: false,
      failed: 1,
      created: 1,
      skippedExists: 0,
      results: [
        {
          status: "created",
          fecha: "2026-10-02",
          hora: 9,
          numero: "03",
          resultadoId: "res-9",
          origen: "AUTOMATICO",
          durationMs: 10,
        },
        {
          status: "error",
          fecha: "2026-10-02",
          hora: 10,
          error: "No se pudo publicar el sorteo.",
          durationMs: 8,
        },
      ],
    });
    const response = await handleAutomaticResultsRequest(authedRequest(), {
      authorize: () => true,
      publish: async () => body,
    });
    assert.equal(response.status, 500);
    const json = await response.json();
    assert.equal(json.ok, false);
    assert.equal(json.failed, 1);
    assert.equal(json.results[0].status, "created");
    assert.equal(json.results[1].hora, 10);
    assert.equal(json.results[1].error, "No se pudo publicar el sorteo.");
    assert.equal(typeof json.durationTotalMs, "number");
    assert.equal(json.slotsAttempted, json.processed);
  });

  it("fallo de todas las franjas responde 500 con ok false", async () => {
    const body = run({
      ok: false,
      failed: 2,
      created: 0,
      skippedExists: 0,
      results: [
        {
          status: "error",
          fecha: "2026-10-02",
          hora: 9,
          error: "No se pudo publicar el sorteo.",
          durationMs: 5,
        },
        {
          status: "error",
          fecha: "2026-10-02",
          hora: 10,
          error: "No se pudo publicar el sorteo.",
          durationMs: 6,
        },
      ],
    });
    const response = await handleAutomaticResultsRequest(authedRequest(), {
      authorize: () => true,
      publish: async () => body,
    });
    assert.equal(response.status, 500);
    const json = await response.json();
    assert.equal(json.ok, false);
    assert.equal(json.failed, 2);
    assert.equal(json.processed, 2);
  });

  it("secreto ausente o inválido responde 401 y no publica", async () => {
    let published = 0;
    const missing = await handleAutomaticResultsRequest(
      new Request("http://local/api/cron/resultados-automaticos"),
      {
        authorize: (request) => authorizeCronRequest(request, {}),
        publish: async () => {
          published += 1;
          return run();
        },
      },
    );
    assert.equal(missing.status, 401);
    const missingBody = await missing.json();
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.error.code, "UNAUTHORIZED");

    const wrong = await handleAutomaticResultsRequest(
      new Request("http://local/api/cron/resultados-automaticos", {
        headers: { authorization: "Bearer otro" },
      }),
      {
        authorize: (request) =>
          authorizeCronRequest(request, { CRON_SECRET: SECRET }),
        publish: async () => {
          published += 1;
          return run();
        },
      },
    );
    assert.equal(wrong.status, 401);
    assert.equal(published, 0);
  });

  it("un error de catálogo conserva el 500 de configuración", async () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const response = await handleAutomaticResultsRequest(authedRequest(), {
        authorize: () => true,
        publish: async () => {
          throw new Error("catalogo invalido SELECT * FROM secret");
        },
      });
      assert.equal(response.status, 500);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "AUTO_PUBLISH_FAILED");
      assert.equal(JSON.stringify(json).includes("catalogo invalido"), false);
      const joined = logs.join("\n");
      assert.equal(joined.includes("catalogo invalido"), false);
      assert.equal(joined.includes("SELECT *"), false);
      assert.equal(joined.includes(SECRET), false);
    } finally {
      console.error = originalError;
    }
  });

  it("ok false con failed mayor que cero no puede responder 200", () => {
    assert.equal(statusForAutomaticPublish({ ok: false, failed: 1 }), 500);
    assert.equal(statusForAutomaticPublish({ ok: true, failed: 0 }), 200);
  });

  it("la respuesta conserva campos previos y añade duración", async () => {
    const response = await handleAutomaticResultsRequest(authedRequest(), {
      authorize: () => true,
      publish: async () =>
        run({
          durationTotalMs: 55,
          slotsAttempted: 2,
          processed: 2,
        }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.equal(json.processed, 2);
    assert.equal(json.slotsAttempted, 2);
    assert.equal(json.created, 1);
    assert.equal(json.skippedExists, 1);
    assert.equal(json.failed, 0);
    assert.equal(json.durationTotalMs, 55);
    assert.equal(typeof json.results[0].durationMs, "number");
    assert.equal(typeof json.at, "string");
    assert.equal(json.catalogSize, 38);
  });
});
