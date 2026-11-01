/**
 * Utilidades para adaptar paneles fijos inferiores al viewport visible
 * (p. ej. cuando el teclado virtual reduce `visualViewport` en móvil).
 *
 * Sin dependencias nuevas. `visualViewport` está disponible en navegadores
 * móviles actuales; si falta, el inset queda en 0 y se usa el CSS de respaldo.
 */

export type VisualViewportLike = {
  height: number;
  offsetTop: number;
};

/**
 * Distancia (px) entre el borde inferior del layout viewport y el visual
 * viewport. Si el teclado reduce la altura visible, el valor es > 0 y una
 * barra `position: fixed; bottom: 0` debe elevarse con `bottom: inset`.
 */
export function visualViewportBottomInset(
  layoutInnerHeight: number,
  visual: VisualViewportLike | null | undefined,
): number {
  if (!visual || !(layoutInnerHeight > 0) || !(visual.height > 0)) {
    return 0;
  }
  return Math.max(
    0,
    Math.round(layoutInnerHeight - visual.height - visual.offsetTop),
  );
}

/**
 * Altura máxima del panel expandido relativa al viewport visible.
 * Devuelve `null` si no hay métricas (usar CSS `max-h-[…dvh]` de respaldo).
 */
export function visualViewportPanelMaxHeightPx(
  visualHeight: number | null | undefined,
  fraction = 0.5,
  minPx = 120,
): number | null {
  if (visualHeight == null || !(visualHeight > 0) || !(fraction > 0)) {
    return null;
  }
  return Math.max(minPx, Math.round(visualHeight * fraction));
}

export type VisualViewportMetrics = {
  bottomInset: number;
  panelMaxHeightPx: number | null;
};

export function readVisualViewportMetrics(
  layoutInnerHeight: number,
  visual: VisualViewportLike | null | undefined,
  panelFraction = 0.5,
): VisualViewportMetrics {
  return {
    bottomInset: visualViewportBottomInset(layoutInnerHeight, visual),
    panelMaxHeightPx: visualViewportPanelMaxHeightPx(
      visual?.height ?? null,
      panelFraction,
    ),
  };
}
