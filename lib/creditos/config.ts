/**
 * Configuración del control de créditos.
 *
 * Default: controlActivo=false, inicioEn=null, umbral=null.
 * Mientras controlActivo sea false O inicioEn sea null, ventaSujetaAControlCreditos
 * es false → se pueden asignar saldos iniciales sin cobro en ventas.
 *
 * inicioEn: DateTime absoluto. Al configurar “desde el día D 00:00 America/Caracas”,
 * convertir ese instante local a UTC antes de guardar (UI admin, fase posterior).
 */
import { Prisma } from "@prisma/client";
import { CreditoConfigError, CreditoValidationError } from "@/lib/creditos/errors";
import { toCreditoDecimal } from "@/lib/creditos/money";
import type { CreditosStore } from "@/lib/creditos/store";
import type { CreditosConfigView } from "@/lib/creditos/types";
import type { CreditosControlSnapshot } from "@/lib/creditos/control";

export async function getCreditosConfig(
  store: CreditosStore,
): Promise<CreditosConfigView> {
  return store.getConfig();
}

export async function getCreditosControlSnapshot(
  store: CreditosStore,
): Promise<CreditosControlSnapshot> {
  const c = await store.getConfig();
  return {
    controlActivo: c.controlActivo,
    inicioEn: c.inicioEn,
    umbralSaldoBajo: c.umbralSaldoBajo,
  };
}

/**
 * Actualiza configuración. No inventa inicioEn.
 * Para activar el control se exige inicioEn no null (ya guardado o en el mismo patch).
 */
export async function actualizarCreditosConfig(
  store: CreditosStore,
  args: {
    controlActivo?: boolean;
    inicioEn?: Date | null;
    umbralSaldoBajo?: Prisma.Decimal | string | number | null;
    updatedByAdminId: string;
    ahora?: Date;
  },
): Promise<CreditosConfigView> {
  const adminId = args.updatedByAdminId.trim();
  if (!adminId) {
    throw new CreditoValidationError("updatedByAdminId requerido.");
  }

  return store.runInTransaction(async (tx) => {
    const actual = await tx.getConfig();
    if (!actual.configPersisted) {
      throw new CreditoConfigError(
        "La configuración de créditos no está inicializada. Ejecute el procedimiento operativo de bootstrap antes de modificarla.",
        "CREDITOS_CONFIG_NO_INICIALIZADA",
      );
    }
    const nextInicio =
      args.inicioEn !== undefined ? args.inicioEn : actual.inicioEn;
    const nextActivo =
      args.controlActivo !== undefined
        ? args.controlActivo
        : actual.controlActivo;

    if (nextActivo && nextInicio == null) {
      throw new CreditoConfigError(
        "No se puede activar el control de créditos sin una fecha/hora de inicio explícita.",
        "CREDITO_INICIO_REQUERIDO",
      );
    }

    let umbral: Prisma.Decimal | null | undefined = undefined;
    if (args.umbralSaldoBajo !== undefined) {
      if (args.umbralSaldoBajo === null) {
        umbral = null;
      } else {
        umbral = toCreditoDecimal(args.umbralSaldoBajo);
        if (umbral.lt(0)) {
          throw new CreditoValidationError(
            "El umbral de saldo bajo no puede ser negativo.",
          );
        }
      }
    }

    return tx.saveConfig(
      {
        controlActivo: nextActivo,
        inicioEn: nextInicio,
        ...(umbral !== undefined ? { umbralSaldoBajo: umbral } : {}),
        updatedByAdminId: adminId,
      },
      args.ahora,
    );
  });
}
