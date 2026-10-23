import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ANIMALES_CANONICOS,
  CATALOGO_ANIMALITOS_ESPERADO,
} from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  animalImagenPath,
  upsertCanonicalAnimals,
} from "@/lib/resultados/ensure-canonical-animals";

describe("upsertCanonicalAnimals", () => {
  it("prepara los 38 animales de la fuente canónica con números y nombres exactos", async () => {
    const upserts: {
      numero: string;
      nombre: string;
      imagen: string;
      updateNombre: string;
      updateImagen: string;
    }[] = [];
    const foreign = {
      resultado: { upsert: 0, create: 0, update: 0, updateMany: 0 },
      ticket: { create: 0 },
      ticketLinea: { create: 0 },
      usuario: { upsert: 0 },
      configNegocio: { upsert: 0 },
      auditoria: { create: 0 },
    };

    const db = {
      animal: {
        async upsert(args: {
          where: { numero: string };
          update: { nombre: string; imagen: string };
          create: { numero: string; nombre: string; imagen: string };
        }) {
          upserts.push({
            numero: args.create.numero,
            nombre: args.create.nombre,
            imagen: args.create.imagen,
            updateNombre: args.update.nombre,
            updateImagen: args.update.imagen,
          });
          return {};
        },
      },
      resultado: {
        async upsert() {
          foreign.resultado.upsert += 1;
          throw new Error("no debe escribir Resultado");
        },
        async create() {
          foreign.resultado.create += 1;
          throw new Error("no debe escribir Resultado");
        },
        async update() {
          foreign.resultado.update += 1;
          throw new Error("no debe escribir Resultado");
        },
        async updateMany() {
          foreign.resultado.updateMany += 1;
          throw new Error("no debe escribir Resultado");
        },
      },
      ticket: {
        async create() {
          foreign.ticket.create += 1;
          throw new Error("no debe escribir Ticket");
        },
      },
      ticketLinea: {
        async create() {
          foreign.ticketLinea.create += 1;
          throw new Error("no debe escribir TicketLinea");
        },
      },
      usuario: {
        async upsert() {
          foreign.usuario.upsert += 1;
          throw new Error("no debe escribir Usuario");
        },
      },
      configNegocio: {
        async upsert() {
          foreign.configNegocio.upsert += 1;
          throw new Error("no debe escribir ConfigNegocio");
        },
      },
      auditoria: {
        async create() {
          foreign.auditoria.create += 1;
          throw new Error("no debe escribir Auditoria");
        },
      },
    };

    const { count } = await upsertCanonicalAnimals(db);

    assert.equal(count, 38);
    assert.equal(count, CATALOGO_ANIMALITOS_ESPERADO);
    assert.equal(upserts.length, ANIMALES_CANONICOS.length);
    assert.equal(upserts.length, 38);

    for (let i = 0; i < ANIMALES_CANONICOS.length; i += 1) {
      const expected = ANIMALES_CANONICOS[i]!;
      const got = upserts[i]!;
      assert.equal(got.numero, expected.numero);
      assert.equal(got.nombre, expected.nombre);
      assert.equal(got.updateNombre, expected.nombre);
      assert.equal(got.imagen, animalImagenPath(expected.numero));
      assert.equal(got.updateImagen, animalImagenPath(expected.numero));
    }

    assert.deepEqual(foreign, {
      resultado: { upsert: 0, create: 0, update: 0, updateMany: 0 },
      ticket: { create: 0 },
      ticketLinea: { create: 0 },
      usuario: { upsert: 0 },
      configNegocio: { upsert: 0 },
      auditoria: { create: 0 },
    });
  });
});

describe("seed-manual-test.ts — catálogo canónico (estático)", () => {
  const scriptPath = path.resolve(
    __dirname,
    "../../scripts/seed-manual-test.ts",
  );
  const src = fs.readFileSync(scriptPath, "utf8");

  it("no conserva una lista hardcodeada de seis animales", () => {
    assert.doesNotMatch(
      src,
      /\{\s*numero:\s*"0",\s*nombre:\s*"Delfín"\s*\}/,
    );
    assert.doesNotMatch(
      src,
      /const animales = \[[\s\S]*numero:\s*"22"[\s\S]*\] as const/,
    );
    assert.match(src, /upsertCanonicalAnimals/);
    assert.match(src, /ANIMALES_CANONICOS|ensure-canonical-animals/);
  });

  it("las guardas TEST aparecen en el fuente antes de la preparación del catálogo", () => {
    const iSafe = src.indexOf("assertSafeTestDatabase");
    const iWrite = src.indexOf("assertIntegrationWriteTarget");
    const iAnimals = src.indexOf("upsertCanonicalAnimals");
    assert.ok(iSafe >= 0, "falta assertSafeTestDatabase");
    assert.ok(iWrite >= 0, "falta assertIntegrationWriteTarget");
    assert.ok(iAnimals >= 0, "falta upsertCanonicalAnimals");
    assert.ok(iSafe < iAnimals, "assertSafeTestDatabase debe preceder al catálogo");
    assert.ok(
      iWrite < iAnimals,
      "assertIntegrationWriteTarget debe preceder al catálogo",
    );
  });
});
