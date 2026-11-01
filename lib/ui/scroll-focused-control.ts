/**
 * Desplaza un control enfocado solo si no está completamente visible
 * en el viewport (layout o visualViewport). Evita saltos en escritorio
 * cuando el campo ya se ve; permite scroll cuando el teclado/panel lo tapa.
 */

export type RectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type ViewportBox = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function isFullyVisibleInViewport(
  el: RectLike,
  vp: ViewportBox,
): boolean {
  return (
    el.top >= vp.top &&
    el.bottom <= vp.bottom &&
    el.left >= vp.left &&
    el.right <= vp.right
  );
}

export function shouldScrollFocusedControlIntoView(
  el: RectLike,
  vp: ViewportBox,
): boolean {
  return !isFullyVisibleInViewport(el, vp);
}

export function readVisibleViewportBox(
  innerWidth: number,
  innerHeight: number,
  visual: { height: number; offsetTop: number; width?: number } | null | undefined,
): ViewportBox {
  if (visual && visual.height > 0) {
    return {
      top: visual.offsetTop,
      bottom: visual.offsetTop + visual.height,
      left: 0,
      right: visual.width != null && visual.width > 0 ? visual.width : innerWidth,
    };
  }
  return { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
}

/** Solo actúa si el elemento no cabe entero en el viewport visible. */
export function scrollFocusedControlIntoView(el: HTMLElement): void {
  if (typeof window === "undefined") return;

  const rect = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const visual = vv
    ? { height: vv.height, offsetTop: vv.offsetTop, width: vv.width }
    : null;
  const vp = readVisibleViewportBox(
    window.innerWidth,
    window.innerHeight,
    visual,
  );

  if (!shouldScrollFocusedControlIntoView(rect, vp)) return;

  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}
