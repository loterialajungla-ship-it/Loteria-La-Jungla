/**
 * Presentación del creador histórico de un ticket (`Ticket.vendedorId` → Usuario).
 * Solo para superficies ADMIN. No inventa datos si falta la atribución.
 */

export type TicketCreatorUserRef = {
  id: string;
  nombre: string;
  usuario: string;
  rol: "ADMIN" | "VENDEDOR";
};

export type TicketCreatorDisplay = {
  /** false → tickets históricos o relación rota; etiqueta = "No disponible". */
  disponible: boolean;
  /** Id persistido (histórico). null si no hay atribución. */
  id: string | null;
  nombre: string | null;
  /** Login de acceso. */
  usuario: string | null;
  rol: "ADMIN" | "VENDEDOR" | null;
  /**
   * Texto compacto para listados.
   * VENDEDOR: nombre → usuario.
   * ADMIN: "Administrador" (+ nombre si aporta).
   */
  etiqueta: string;
};

export const TICKET_CREATOR_UNAVAILABLE_LABEL = "No disponible";

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Construye la vista del creador a partir de la fila Usuario enlazada
 * (o null si `vendedorId` es null / usuario ausente).
 */
export function formatTicketCreatorDisplay(
  user: TicketCreatorUserRef | null | undefined,
): TicketCreatorDisplay {
  if (!user) {
    return {
      disponible: false,
      id: null,
      nombre: null,
      usuario: null,
      rol: null,
      etiqueta: TICKET_CREATOR_UNAVAILABLE_LABEL,
    };
  }

  const nombre = trimOrNull(user.nombre);
  const usuario = trimOrNull(user.usuario);
  const rol = user.rol === "ADMIN" || user.rol === "VENDEDOR" ? user.rol : null;

  if (!rol) {
    return {
      disponible: false,
      id: user.id,
      nombre,
      usuario,
      rol: null,
      etiqueta: TICKET_CREATOR_UNAVAILABLE_LABEL,
    };
  }

  if (rol === "ADMIN") {
    const etiqueta = nombre
      ? `Administrador · ${nombre}`
      : usuario
        ? `Administrador · ${usuario}`
        : "Administrador";
    return {
      disponible: true,
      id: user.id,
      nombre,
      usuario,
      rol,
      etiqueta,
    };
  }

  const etiqueta = nombre ?? usuario ?? TICKET_CREATOR_UNAVAILABLE_LABEL;
  const disponible = etiqueta !== TICKET_CREATOR_UNAVAILABLE_LABEL;

  return {
    disponible,
    id: user.id,
    nombre,
    usuario,
    rol,
    etiqueta,
  };
}
