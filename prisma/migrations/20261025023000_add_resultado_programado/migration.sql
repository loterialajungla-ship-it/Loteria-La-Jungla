-- CreateEnum
CREATE TYPE "EstadoResultadoProgramado" AS ENUM ('PENDIENTE', 'PUBLICADO', 'CANCELADO', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ResultadoProgramado" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "hora" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "estado" "EstadoResultadoProgramado" NOT NULL DEFAULT 'PENDIENTE',
    "resultadoId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultadoProgramado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResultadoProgramado_resultadoId_key" ON "ResultadoProgramado"("resultadoId");

-- CreateIndex
CREATE INDEX "ResultadoProgramado_estado_fecha_idx" ON "ResultadoProgramado"("estado", "fecha");

-- CreateIndex
CREATE INDEX "ResultadoProgramado_createdById_createdAt_idx" ON "ResultadoProgramado"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultadoProgramado_fecha_hora_key" ON "ResultadoProgramado"("fecha", "hora");

-- AddForeignKey
ALTER TABLE "ResultadoProgramado" ADD CONSTRAINT "ResultadoProgramado_numero_fkey" FOREIGN KEY ("numero") REFERENCES "Animal"("numero") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultadoProgramado" ADD CONSTRAINT "ResultadoProgramado_resultadoId_fkey" FOREIGN KEY ("resultadoId") REFERENCES "Resultado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultadoProgramado" ADD CONSTRAINT "ResultadoProgramado_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
