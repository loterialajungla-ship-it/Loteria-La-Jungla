/**
 * Destino de /venta/caja según el rol ya resuelto en el servidor.
 * ADMIN no usa la pantalla ni las APIs de Mi Caja.
 */
export const VENTA_CAJA_PATH = "/venta/caja";
export const ADMIN_CAJA_PATH = "/admin/caja";
export const LOGIN_PATH = "/login";

export type VentaCajaAccess =
  | { kind: "redirect"; to: typeof ADMIN_CAJA_PATH | typeof LOGIN_PATH }
  | { kind: "vendor" };

export function decideVentaCajaAccess(
  rol: string | null | undefined,
): VentaCajaAccess {
  if (rol === "ADMIN") return { kind: "redirect", to: ADMIN_CAJA_PATH };
  if (rol === "VENDEDOR") return { kind: "vendor" };
  return { kind: "redirect", to: LOGIN_PATH };
}
