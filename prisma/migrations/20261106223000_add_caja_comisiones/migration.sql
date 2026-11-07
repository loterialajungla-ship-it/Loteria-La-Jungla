-- AlterEnum AccionAuditoria
ALTER TYPE "AccionAuditoria" ADD VALUE 'ACTIVAR_CAJA';
ALTER TYPE "AccionAuditoria" ADD VALUE 'CREAR_COMISION_VENDEDOR';
ALTER TYPE "AccionAuditoria" ADD VALUE 'CAMBIAR_COMISION_VENDEDOR';

-- AlterEnum EntidadAuditoria
ALTER TYPE "EntidadAuditoria" ADD VALUE 'CAJA_CONFIG';
ALTER TYPE "EntidadAuditoria" ADD VALUE 'VENDEDOR_COMISION';

-- CreateTable CajaConfig (singleton id = 1)
CREATE TABLE "CajaConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "activadaEn" TIMESTAMP(3),
    "activadaPorAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CajaConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CajaConfig_singleton" CHECK ("id" = 1)
);

-- CreateTable VendedorComision
CREATE TABLE "VendedorComision" (
    "vendedorId" TEXT NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "VendedorComision_pkey" PRIMARY KEY ("vendedorId"),
    CONSTRAINT "VendedorComision_porcentaje_range" CHECK ("porcentaje" >= 0 AND "porcentaje" <= 100)
);

-- CreateTable VendedorComisionHistorial
CREATE TABLE "VendedorComisionHistorial" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "porcentajeAnterior" DECIMAL(5,2),
    "porcentajeNuevo" DECIMAL(5,2) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByAdminId" TEXT,
    "motivo" TEXT,

    CONSTRAINT "VendedorComisionHistorial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VendedorComisionHistorial_nuevo_range" CHECK ("porcentajeNuevo" >= 0 AND "porcentajeNuevo" <= 100),
    CONSTRAINT "VendedorComisionHistorial_anterior_range" CHECK (
      "porcentajeAnterior" IS NULL
      OR ("porcentajeAnterior" >= 0 AND "porcentajeAnterior" <= 100)
    )
);

-- CreateIndex
CREATE INDEX "VendedorComisionHistorial_vendedorId_changedAt_idx"
ON "VendedorComisionHistorial"("vendedorId", "changedAt");

-- AddForeignKey
ALTER TABLE "CajaConfig"
ADD CONSTRAINT "CajaConfig_activadaPorAdminId_fkey"
FOREIGN KEY ("activadaPorAdminId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendedorComision"
ADD CONSTRAINT "VendedorComision_vendedorId_fkey"
FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendedorComision"
ADD CONSTRAINT "VendedorComision_updatedByAdminId_fkey"
FOREIGN KEY ("updatedByAdminId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendedorComisionHistorial"
ADD CONSTRAINT "VendedorComisionHistorial_vendedorId_fkey"
FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendedorComisionHistorial"
ADD CONSTRAINT "VendedorComisionHistorial_changedByAdminId_fkey"
FOREIGN KEY ("changedByAdminId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
