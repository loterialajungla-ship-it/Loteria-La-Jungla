import type { AccionAuditoria, EntidadAuditoria } from "@prisma/client";
import type { AuditDetalle } from "@/lib/audit/audit";
import { formatearHoraSorteo } from "@/lib/fecha";

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function animalLabel(
  numero: string | null,
  nombrePorNumero: Map<string, string>,
): string {
  if (!numero) return "—";
  const nombre = nombrePorNumero.get(numero);
  return nombre ? `${numero} - ${nombre}` : numero;
}

/**
 * Texto legible para UI. Los números quedan en `detalle` para historia.
 */
export function formatAuditDetalleLegible(args: {
  accion: AccionAuditoria;
  entidad: EntidadAuditoria;
  entidadId: string;
  detalle: AuditDetalle | null;
  nombrePorNumero?: Map<string, string>;
}): string {
  const d = args.detalle ?? {};
  const names = args.nombrePorNumero ?? new Map<string, string>();

  switch (args.accion) {
    case "CREAR_RESULTADO": {
      const fecha = str(d.fecha);
      const hora = typeof d.hora === "number" ? d.hora : Number(d.hora);
      const numero = str(d.numeroNuevo) ?? str(d.numero);
      const horaLabel = Number.isInteger(hora)
        ? formatearHoraSorteo(hora)
        : "?";
      return `Resultado ${fecha ?? "?"} ${horaLabel}: ${animalLabel(numero, names)}`;
    }
    case "MODIFICAR_RESULTADO": {
      const ant = str(d.numeroAnterior);
      const neu = str(d.numeroNuevo);
      const fecha = str(d.fecha);
      const hora = typeof d.hora === "number" ? d.hora : Number(d.hora);
      const horaLabel = Number.isInteger(hora)
        ? formatearHoraSorteo(hora)
        : "?";
      return `Resultado ${fecha ?? "?"} ${horaLabel}: ${animalLabel(ant, names)} → ${animalLabel(neu, names)}`;
    }
    case "ANULAR_TICKET": {
      const motivo = str(d.motivo) ?? str(d.motivoAnulacion) ?? "";
      const num = str(d.numeroVisible) ?? args.entidadId;
      return motivo
        ? `Anulación ${num}: ${motivo}`
        : `Anulación ${num}`;
    }
    case "CREAR_TICKET": {
      const num = str(d.numeroVisible) ?? args.entidadId;
      const total = str(d.totalApostado);
      return total ? `Ticket ${num} · $${total}` : `Ticket ${num}`;
    }
    case "CREAR_VENDEDOR": {
      const nombre = str(d.nombre) ?? "";
      const usuario = str(d.usuario) ?? "";
      return `Vendedor ${nombre}${usuario ? ` (${usuario})` : ""}`.trim();
    }
    case "ACTIVAR_VENDEDOR":
    case "DESACTIVAR_VENDEDOR": {
      const usuario = str(d.usuario) ?? args.entidadId;
      const ant = d.estadoAnterior;
      const neu = d.estadoNuevo;
      if (typeof ant === "boolean" && typeof neu === "boolean") {
        return `${usuario}: ${ant ? "activo" : "inactivo"} → ${neu ? "activo" : "inactivo"}`;
      }
      return args.accion === "ACTIVAR_VENDEDOR"
        ? `Activación ${usuario}`
        : `Desactivación ${usuario}`;
    }
    case "CAMBIAR_PASSWORD":
      return "Cambio de contraseña propia";
    case "RESET_PASSWORD": {
      const objetivo = str(d.usuarioObjetivo) ?? args.entidadId;
      return `Restablecimiento de contraseña: ${objetivo}`;
    }
    case "LOGIN":
      return "Inicio de sesión";
    case "LOGOUT":
      return "Cierre de sesión";
    default:
      return args.accion;
  }
}
