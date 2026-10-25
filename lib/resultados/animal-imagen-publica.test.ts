import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";
import {
  ANIMAL_IMAGEN_ARCHIVO_ORIGEN,
  animalImagenPublicaSrc,
  validateAnimalImagenPublicaMap,
} from "@/lib/resultados/animal-imagen-publica";

describe("animalImagenPublicaSrc", () => {
  it("asocia por número canónico string, no por nombre", () => {
    assert.equal(animalImagenPublicaSrc("00"), "/animals/00.webp");
    assert.equal(animalImagenPublicaSrc("0"), "/animals/0.webp");
    assert.notEqual(
      animalImagenPublicaSrc("00"),
      animalImagenPublicaSrc("0"),
    );
  });

  it("no colapsa 00 y 0 vía Number() ni parseInt", () => {
    assert.equal(Number("00"), Number("0"));
    assert.notEqual(animalImagenPublicaSrc("00"), animalImagenPublicaSrc("0"));
    assert.match(animalImagenPublicaSrc("00")!, /\/00\.webp$/);
    assert.match(animalImagenPublicaSrc("0")!, /\/0\.webp$/);
  });

  it("devuelve null para números desconocidos o no string", () => {
    assert.equal(animalImagenPublicaSrc("37"), null);
    assert.equal(animalImagenPublicaSrc(""), null);
    assert.equal(animalImagenPublicaSrc("Ballena"), null);
    assert.equal(animalImagenPublicaSrc(" 00 "), null);
  });

  it("cubre los 38 animales canónicos con rutas /animals/{numero}.webp", () => {
    for (const animal of ANIMALES_CANONICOS) {
      assert.equal(
        animalImagenPublicaSrc(animal.numero),
        `/animals/${animal.numero}.webp`,
        `numero=${animal.numero}`,
      );
      assert.ok(
        ANIMAL_IMAGEN_ARCHIVO_ORIGEN[animal.numero],
        `falta archivo origen para ${animal.numero}`,
      );
    }
  });

  it("validateAnimalImagenPublicaMap alinea el mapa con el catálogo", () => {
    const v = validateAnimalImagenPublicaMap();
    assert.equal(v.ok, true);
    assert.deepEqual(v.missing, []);
    assert.deepEqual(v.extra, []);
    assert.equal(Object.keys(ANIMAL_IMAGEN_ARCHIVO_ORIGEN).length, 38);
  });
});
