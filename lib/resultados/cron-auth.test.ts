import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeCronRequest,
  extractCronSecret,
  safeEqualSecret,
} from "@/lib/resultados/cron-auth";

describe("cron-auth", () => {
  it("safeEqualSecret rechaza distinto o vacío", () => {
    assert.equal(safeEqualSecret("abc", "abc"), true);
    assert.equal(safeEqualSecret("abc", "abd"), false);
    assert.equal(safeEqualSecret("abc", "ab"), false);
    assert.equal(safeEqualSecret(null, "abc"), false);
    assert.equal(safeEqualSecret("abc", ""), false);
  });

  it("extractCronSecret lee Bearer y x-cron-secret", () => {
    assert.equal(
      extractCronSecret(
        new Request("http://local/cron", {
          headers: { authorization: "Bearer secreto-1" },
        }),
      ),
      "secreto-1",
    );
    assert.equal(
      extractCronSecret(
        new Request("http://local/cron", {
          headers: { "x-cron-secret": "secreto-2" },
        }),
      ),
      "secreto-2",
    );
    assert.equal(
      extractCronSecret(new Request("http://local/cron")),
      null,
    );
  });

  it("authorizeCronRequest exige CRON_SECRET y coincidencia", () => {
    const env = { CRON_SECRET: "cron-test-secret" };
    assert.equal(
      authorizeCronRequest(new Request("http://local/cron"), env),
      false,
    );
    assert.equal(
      authorizeCronRequest(
        new Request("http://local/cron", {
          headers: { authorization: "Bearer wrong" },
        }),
        env,
      ),
      false,
    );
    assert.equal(
      authorizeCronRequest(
        new Request("http://local/cron", {
          headers: { authorization: "Bearer cron-test-secret" },
        }),
        env,
      ),
      true,
    );
    assert.equal(
      authorizeCronRequest(
        new Request("http://local/cron", {
          headers: { authorization: "Bearer x" },
        }),
        {},
      ),
      false,
    );
  });
});
