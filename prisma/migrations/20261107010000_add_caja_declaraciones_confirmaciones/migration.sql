-- AlterEnum AccionAuditoria
ALTER TYPE "AccionAuditoria" ADD VALUE 'CREAR_CAJA_DECLARACION';
ALTER TYPE "AccionAuditoria" ADD VALUE 'CREAR_CAJA_CONFIRMACION';

-- AlterEnum EntidadAuditoria
ALTER TYPE "EntidadAuditoria" ADD VALUE 'CAJA_DECLARACION';
ALTER TYPE "EntidadAuditoria" ADD VALUE 'CAJA_CONFIRMACION';

-- CreateTable CajaDeclaracion
CREATE TABLE "CajaDeclaracion" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "importeDeclarado" DECIMAL(12,2) NOT NULL,
    "declaradoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyRequestHash" TEXT,
    "nota" TEXT,

    CONSTRAINT "CajaDeclaracion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CajaDeclaracion_importe_positive" CHECK ("importeDeclarado" > 0)
);

-- CreateTable CajaConfirmacion
CREATE TABLE "CajaConfirmacion" (
    "id" TEXT NOT NULL,
    "declaracionId" TEXT NOT NULL,
    "importeConfirmado" DECIMAL(12,2) NOT NULL,
    "confirmadoPorAdminId" TEXT NOT NULL,
    "confirmadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyRequestHash" TEXT,

    CONSTRAINT "CajaConfirmacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CajaConfirmacion_importe_positive" CHECK ("importeConfirmado" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CajaDeclaracion_idempotencyKey_key" ON "CajaDeclaracion"("idempotencyKey");
CREATE INDEX "CajaDeclaracion_vendedorId_declaradoAt_idx" ON "CajaDeclaracion"("vendedorId", "declaradoAt");

CREATE UNIQUE INDEX "CajaConfirmacion_idempotencyKey_key" ON "CajaConfirmacion"("idempotencyKey");
CREATE INDEX "CajaConfirmacion_declaracionId_confirmadoAt_idx" ON "CajaConfirmacion"("declaracionId", "confirmadoAt");
CREATE INDEX "CajaConfirmacion_confirmadoPorAdminId_confirmadoAt_idx" ON "CajaConfirmacion"("confirmadoPorAdminId", "confirmadoAt");

-- AddForeignKey
ALTER TABLE "CajaDeclaracion"
ADD CONSTRAINT "CajaDeclaracion_vendedorId_fkey"
FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CajaConfirmacion"
ADD CONSTRAINT "CajaConfirmacion_declaracionId_fkey"
FOREIGN KEY ("declaracionId") REFERENCES "CajaDeclaracion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CajaConfirmacion"
ADD CONSTRAINT "CajaConfirmacion_confirmadoPorAdminId_fkey"
FOREIGN KEY ("confirmadoPorAdminId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
