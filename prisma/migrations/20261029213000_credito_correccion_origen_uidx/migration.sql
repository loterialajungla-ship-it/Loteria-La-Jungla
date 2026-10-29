-- Una sola corrección por movimiento de origen (índice parcial; no expresable en Prisma schema).
CREATE UNIQUE INDEX "CreditoMovimiento_correccion_origen_uidx"
ON "CreditoMovimiento" ("movimientoOrigenId")
WHERE "tipo" = 'CORRECCION'
  AND "movimientoOrigenId" IS NOT NULL;
