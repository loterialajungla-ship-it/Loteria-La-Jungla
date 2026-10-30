/**
 * Validación estática de la migración de bootstrap CreditosConfig.
 * No conecta a PostgreSQL/Neon (limitación documentada: no se ejecuta SQL real).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION_DIR = path.join(
  ROOT,
  "prisma",
  "migrations",
  "20261030140000_creditos_config_bootstrap",
);
const MIGRATION_SQL = path.join(MIGRATION_DIR, "migration.sql");
const PRIOR_CREDITS =
  "20261029170000_add_vendedor_creditos";
const PRIOR_UIDX = "20261029213000_credito_correccion_origen_uidx";

describe("migración bootstrap CreditosConfig (estática)", () => {
  it("existe con timestamp posterior a las migraciones de créditos", () => {
    assert.ok(fs.existsSync(MIGRATION_SQL), "falta migration.sql");
    const migrationsRoot = path.join(ROOT, "prisma", "migrations");
    const dirs = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    assert.ok(dirs.includes(PRIOR_CREDITS));
    assert.ok(dirs.includes(PRIOR_UIDX));
    assert.ok(dirs.includes("20261030140000_creditos_config_bootstrap"));
    const idxBootstrap = dirs.indexOf("20261030140000_creditos_config_bootstrap");
    const idxUidx = dirs.indexOf(PRIOR_UIDX);
    assert.ok(idxBootstrap > idxUidx);
  });

  it("inserta fila inicial con ON CONFLICT DO NOTHING", () => {
    const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
    assert.match(sql, /INSERT\s+INTO\s+"CreditosConfig"/i);
    assert.match(sql, /ON\s+CONFLICT\s+\("id"\)\s+DO\s+NOTHING/i);
    assert.match(sql, /\bfalse\b/i);
    assert.match(sql, /NULL/);
    assert.doesNotMatch(sql, /UPDATE\s+"CreditosConfig"/i);
    assert.doesNotMatch(sql, /VendedorCreditoCuenta/i);
    assert.doesNotMatch(sql, /CreditoMovimiento/i);
    assert.doesNotMatch(sql, /controlActivo\s*=\s*true/i);
  });

  it("columnas compatibles con el esquema de creación", () => {
    const createSql = fs.readFileSync(
      path.join(
        ROOT,
        "prisma",
        "migrations",
        PRIOR_CREDITS,
        "migration.sql",
      ),
      "utf8",
    );
    assert.match(createSql, /CREATE TABLE "CreditosConfig"/);
    const bootstrap = fs.readFileSync(MIGRATION_SQL, "utf8");
    for (const col of [
      "id",
      "controlActivo",
      "inicioEn",
      "umbralSaldoBajo",
      "updatedAt",
      "updatedByAdminId",
    ]) {
      assert.match(bootstrap, new RegExp(`"${col}"`));
      assert.match(createSql, new RegExp(`"${col}"`));
    }
  });

  it("no altera migraciones históricas", () => {
    const hist = path.join(
      ROOT,
      "prisma",
      "migrations",
      PRIOR_CREDITS,
      "migration.sql",
    );
    const text = fs.readFileSync(hist, "utf8");
    assert.doesNotMatch(text, /ON CONFLICT.*"CreditosConfig"/i);
  });
});
