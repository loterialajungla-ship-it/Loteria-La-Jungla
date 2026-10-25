/**
 * Asociación explícita número canónico → imagen pública (WebP).
 * Claves = Animal.numero string ("0", "00", "01"…"36"); nunca Number().
 */
import { ANIMALES_CANONICOS } from "@/lib/resultados/catalogo-animalitos-canonico";

/**
 * Archivo fuente en `loteria_jungla_imagenes_animales/loteria_jungla_animales/`
 * por número canónico. Solo para trazabilidad / tests; la URL pública usa el número.
 */
export const ANIMAL_IMAGEN_ARCHIVO_ORIGEN: Readonly<Record<string, string>> = {
  "0": "0_delfin.webp",
  "00": "00_ballena.webp",
  "01": "01_carnero.webp",
  "02": "02_toro.webp",
  "03": "03_ciem-pies.webp",
  "04": "04_alacran.webp",
  "05": "05_leon.webp",
  "06": "06_rana.webp",
  "07": "07_perico.webp",
  "08": "08_raton.webp",
  "09": "09_aguila.webp",
  "10": "10_tigre.webp",
  "11": "11_gato.webp",
  "12": "12_caballo.webp",
  "13": "13_mono.webp",
  "14": "14_paloma.webp",
  "15": "15_zorro.webp",
  "16": "16_oso.webp",
  "17": "17_pavo.webp",
  "18": "18_burro.webp",
  "19": "19_chivo.webp",
  "20": "20_cerdo.webp",
  "21": "21_gallo.webp",
  "22": "22_camello.webp",
  "23": "23_cebra.webp",
  "24": "24_iguana.webp",
  "25": "25_gallina.webp",
  "26": "26_vaca.webp",
  "27": "27_perro.webp",
  "28": "28_zamuro.webp",
  "29": "29_elefante.webp",
  "30": "30_caiman.webp",
  "31": "31_lapa.webp",
  "32": "32_ardilla.webp",
  "33": "33_pescado.webp",
  "34": "34_venado.webp",
  "35": "35_jirafa.webp",
  "36": "36_culebra.webp",
} as const;

/** Ruta estática servida desde `public/animals/{numero}.webp`. */
export function animalImagenPublicaSrc(numero: string): string | null {
  if (typeof numero !== "string" || numero.length === 0) return null;
  if (!(numero in ANIMAL_IMAGEN_ARCHIVO_ORIGEN)) return null;
  return `/animals/${numero}.webp`;
}

/** Comprueba que el mapa cubre exactamente el catálogo canónico (38). */
export function validateAnimalImagenPublicaMap(): {
  ok: boolean;
  missing: string[];
  extra: string[];
} {
  const canon = new Set(ANIMALES_CANONICOS.map((a) => a.numero));
  const mapped = new Set(Object.keys(ANIMAL_IMAGEN_ARCHIVO_ORIGEN));
  const missing = [...canon].filter((n) => !mapped.has(n)).sort();
  const extra = [...mapped].filter((n) => !canon.has(n)).sort();
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}
