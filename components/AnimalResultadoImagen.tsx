import Image from "next/image";
import { animalImagenPublicaSrc } from "@/lib/resultados/animal-imagen-publica";

type Props = {
  numero: string;
  nombre: string;
  /** Priorizar las primeras franjas del día (above the fold). */
  priority?: boolean;
  className?: string;
};

const BOX = "h-14 w-14 shrink-0 sm:h-16 sm:w-16";

/**
 * Miniatura del animal en resultados públicos.
 * Resuelve la imagen solo por número canónico; si no hay asset, placeholder seguro.
 */
export function AnimalResultadoImagen({
  numero,
  nombre,
  priority = false,
  className = "",
}: Props) {
  const src = animalImagenPublicaSrc(numero);

  if (!src) {
    return (
      <div
        className={`${BOX} rounded-lj-lg border border-emerald-800/80 bg-emerald-950/80 ${className}`}
        aria-hidden
        title={`Sin imagen (${numero})`}
      />
    );
  }

  return (
    <div
      className={`${BOX} relative overflow-hidden rounded-lj-lg border border-emerald-700/50 bg-emerald-950/60 ${className}`}
    >
      <Image
        src={src}
        alt={`${numero} ${nombre}`}
        fill
        sizes="(max-width: 640px) 56px, 64px"
        className="object-contain p-0.5"
        priority={priority}
      />
    </div>
  );
}
