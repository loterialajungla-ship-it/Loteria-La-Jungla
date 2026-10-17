import Image from "next/image";
import { cn } from "@/components/ui/cn";

/** Emblema oficial con transparencia real (PNG). */
export const BRAND_LOGO_SRC = "/brand/logo-transparent.png";
export const BRAND_LOGO_ALT = "Lotería La Jungla";

/** Proporción del archivo fuente (940×1024). */
const LOGO_ASPECT = 940 / 1024;

type Size = "sm" | "md" | "lg" | "hero";

const SIZE_H: Record<Size, number> = {
  sm: 44,
  md: 64,
  lg: 96,
  hero: 140,
};

type Props = {
  size?: Size;
  className?: string;
  /** Prioridad de carga (login / hero público). */
  priority?: boolean;
  /**
   * Compatibilidad con usos previos sobre fondo oscuro.
   * Con PNG transparente ya no recorta; solo conserva el tipado de props.
   */
  onDark?: boolean;
};

/**
 * Emblema oficial. Proporción original con object-fit contain.
 */
export function BrandLogo({
  size = "md",
  className,
  priority = false,
  onDark = false,
}: Props) {
  const height = SIZE_H[size];
  const width = Math.round(height * LOGO_ASPECT);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        onDark && "drop-shadow-lg",
        className,
      )}
      style={{ width, height }}
    >
      <Image
        src={BRAND_LOGO_SRC}
        alt={BRAND_LOGO_ALT}
        width={width}
        height={height}
        priority={priority}
        className="h-full w-full object-contain select-none"
      />
    </span>
  );
}
