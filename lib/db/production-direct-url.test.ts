import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireProductionDirectUrlForInteractiveTx } from "@/lib/db/production-direct-url";

describe("requireProductionDirectUrlForInteractiveTx", () => {
  const prefix = "Eliminación de usuarios no-ADMIN de producción abortada";

  it("devuelve DIRECT_URL trimmeada (sin usar DATABASE_URL)", () => {
    const url = requireProductionDirectUrlForInteractiveTx(
      {
        DIRECT_URL: "  postgresql://u:p@ep-prod/host/db  ",
        DATABASE_URL: "postgresql://u:p@ep-prod-pooler/host/db",
      },
      prefix,
    );
    assert.equal(url, "postgresql://u:p@ep-prod/host/db");
    assert.doesNotMatch(url, /pooler/);
  });

  it("falla si falta DIRECT_URL", () => {
    assert.throws(
      () =>
        requireProductionDirectUrlForInteractiveTx(
          { DATABASE_URL: "postgresql://u:p@host/db" },
          prefix,
        ),
      /falta DIRECT_URL/,
    );
  });

  it("falla si DIRECT_URL es solo espacios", () => {
    assert.throws(
      () =>
        requireProductionDirectUrlForInteractiveTx(
          { DIRECT_URL: "   " },
          prefix,
        ),
      /falta DIRECT_URL/,
    );
  });

  it("incluye el prefijo de aborto en el mensaje (sin filtrar URL)", () => {
    assert.throws(
      () => requireProductionDirectUrlForInteractiveTx({}, prefix),
      new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
