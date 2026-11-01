"use client";

import { useEffect, useState } from "react";
import {
  readVisualViewportMetrics,
  type VisualViewportMetrics,
} from "@/lib/ui/visual-viewport";

const INITIAL: VisualViewportMetrics = {
  bottomInset: 0,
  panelMaxHeightPx: null,
};

/**
 * Lee `window.visualViewport` y actualiza inset inferior + max-height del panel.
 * Limpia listeners en unmount; no registra listeners globales duplicados por
 * instancia más allá del ciclo de vida del componente.
 */
export function useVisualViewportBottomMetrics(
  panelFraction = 0.48,
): VisualViewportMetrics {
  const [metrics, setMetrics] = useState<VisualViewportMetrics>(INITIAL);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => {
      const vv = window.visualViewport;
      const visual = vv
        ? { height: vv.height, offsetTop: vv.offsetTop }
        : null;
      setMetrics(
        readVisualViewportMetrics(window.innerHeight, visual, panelFraction),
      );
    };

    sync();

    const vv = window.visualViewport;
    window.addEventListener("resize", sync);
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);

    return () => {
      window.removeEventListener("resize", sync);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    };
  }, [panelFraction]);

  return metrics;
}
