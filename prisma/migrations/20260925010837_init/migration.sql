-- CreateTable
CREATE TABLE "Animal" (
    "numero" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "imagen" TEXT,

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("numero")
);

-- CreateTable
CREATE TABLE "Resultado" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "hora" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resultado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Resultado_fecha_hora_key" ON "Resultado"("fecha", "hora");

-- AddForeignKey
ALTER TABLE "Resultado" ADD CONSTRAINT "Resultado_numero_fkey" FOREIGN KEY ("numero") REFERENCES "Animal"("numero") ON DELETE RESTRICT ON UPDATE CASCADE;
