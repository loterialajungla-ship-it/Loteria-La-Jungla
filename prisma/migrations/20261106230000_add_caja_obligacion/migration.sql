-- AlterEnum AccionAuditoria
ALTER TYPE "AccionAuditoria" ADD VALUE 'CREAR_CAJA_OBLIGACION';

-- AlterEnum EntidadAuditoria
ALTER TYPE "EntidadAuditoria" ADD VALUE 'CAJA_OBLIGACION';

-- CreateTable CajaObligacion (1:1 con Ticket elegible)
CREATE TABLE "CajaObligacion" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "bruto" DECIMAL(12,2) NOT NULL,
    "comisionPorcentaje" DECIMAL(5,2) NOT NULL,
    "comisionImporte" DECIMAL(12,2) NOT NULL,
    "importeAdmin" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaObligacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CajaObligacion_bruto_nonneg" CHECK ("bruto" >= 0),
    CONSTRAINT "CajaObligacion_comisionImporte_nonneg" CHECK ("comisionImporte" >= 0),
    CONSTRAINT "CajaObligacion_importeAdmin_nonneg" CHECK ("importeAdmin" >= 0),
    CONSTRAINT "CajaObligacion_porcentaje_range" CHECK (
      "comisionPorcentaje" >= 0 AND "comisionPorcentaje" <= 100
    ),
    CONSTRAINT "CajaObligacion_importeAdmin_eq_bruto_menos_comision" CHECK (
      "importeAdmin" = "bruto" - "comisionImporte"
    )
);

-- CreateIndex (unicidad 1:1 ticket)
CREATE UNIQUE INDEX "CajaObligacion_ticketId_key" ON "CajaObligacion"("ticketId");

-- CreateIndex (consulta por vendedor + antigüedad)
CREATE INDEX "CajaObligacion_vendedorId_createdAt_ticketId_idx"
ON "CajaObligacion"("vendedorId", "createdAt", "ticketId");

-- AddForeignKey
ALTER TABLE "CajaObligacion"
ADD CONSTRAINT "CajaObligacion_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CajaObligacion"
ADD CONSTRAINT "CajaObligacion_vendedorId_fkey"
FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
