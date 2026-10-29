-- CreateEnum
CREATE TYPE "TipoCreditoMovimiento" AS ENUM (
  'ASIGNACION',
  'RETIRO',
  'CONSUMO_VENTA',
  'DEVOLUCION_ANULACION',
  'CORRECCION'
);

-- CreateTable
CREATE TABLE "VendedorCreditoCuenta" (
    "vendedorId" TEXT NOT NULL,
    "saldoDisponible" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendedorCreditoCuenta_pkey" PRIMARY KEY ("vendedorId"),
    CONSTRAINT "VendedorCreditoCuenta_saldo_non_negative" CHECK ("saldoDisponible" >= 0)
);

-- CreateTable
CREATE TABLE "CreditoMovimiento" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "tipo" "TipoCreditoMovimiento" NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "saldoAnterior" DECIMAL(12,2) NOT NULL,
    "saldoPosterior" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorAdminId" TEXT,
    "ticketId" TEXT,
    "movimientoOrigenId" TEXT,
    "motivo" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "CreditoMovimiento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreditoMovimiento_importe_positive" CHECK ("importe" > 0),
    CONSTRAINT "CreditoMovimiento_saldos_non_negative" CHECK ("saldoAnterior" >= 0 AND "saldoPosterior" >= 0),
    CONSTRAINT "CreditoMovimiento_saldos_coherent" CHECK (
      (
        "tipo" IN ('ASIGNACION', 'DEVOLUCION_ANULACION')
        AND "saldoPosterior" = "saldoAnterior" + "importe"
      )
      OR (
        "tipo" IN ('RETIRO', 'CONSUMO_VENTA')
        AND "saldoPosterior" = "saldoAnterior" - "importe"
      )
      OR (
        "tipo" = 'CORRECCION'
        AND (
          "saldoPosterior" = "saldoAnterior" + "importe"
          OR "saldoPosterior" = "saldoAnterior" - "importe"
        )
      )
    )
);

-- CreateTable
CREATE TABLE "CreditosConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "controlActivo" BOOLEAN NOT NULL DEFAULT false,
    "inicioEn" TIMESTAMP(3),
    "umbralSaldoBajo" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "CreditosConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreditosConfig_singleton" CHECK ("id" = 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditoMovimiento_idempotencyKey_key" ON "CreditoMovimiento"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditoMovimiento_vendedorId_createdAt_idx" ON "CreditoMovimiento"("vendedorId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditoMovimiento_tipo_createdAt_idx" ON "CreditoMovimiento"("tipo", "createdAt");

-- CreateIndex
CREATE INDEX "CreditoMovimiento_movimientoOrigenId_idx" ON "CreditoMovimiento"("movimientoOrigenId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditoMovimiento_ticketId_tipo_key" ON "CreditoMovimiento"("ticketId", "tipo");

-- Una sola devolución por movimiento de consumo (índice parcial; no expresable en Prisma schema).
CREATE UNIQUE INDEX "CreditoMovimiento_devolucion_origen_uidx"
ON "CreditoMovimiento" ("movimientoOrigenId")
WHERE "tipo" = 'DEVOLUCION_ANULACION' AND "movimientoOrigenId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "VendedorCreditoCuenta" ADD CONSTRAINT "VendedorCreditoCuenta_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditoMovimiento" ADD CONSTRAINT "CreditoMovimiento_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "VendedorCreditoCuenta"("vendedorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditoMovimiento" ADD CONSTRAINT "CreditoMovimiento_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditoMovimiento" ADD CONSTRAINT "CreditoMovimiento_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditoMovimiento" ADD CONSTRAINT "CreditoMovimiento_movimientoOrigenId_fkey" FOREIGN KEY ("movimientoOrigenId") REFERENCES "CreditoMovimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
