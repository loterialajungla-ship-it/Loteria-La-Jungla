-- CreateEnum
CREATE TYPE "EstadoTicket" AS ENUM ('EMITIDO', 'ANULADO');

-- CreateTable
CREATE TABLE "ConfigNegocio" (
    "clave" TEXT NOT NULL,
    "valorInt" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigNegocio_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "TicketCounter" (
    "fechaJuego" DATE NOT NULL,
    "ultimoNumero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("fechaJuego")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "numeroVisible" TEXT NOT NULL,
    "codigoPublico" TEXT NOT NULL,
    "fechaJuego" DATE NOT NULL,
    "vendedorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalApostado" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoTicket" NOT NULL DEFAULT 'EMITIDO',
    "anuladoAt" TIMESTAMP(3),
    "anuladoPorId" TEXT,
    "motivoAnulacion" TEXT,
    "multiplicadorUsado" INTEGER NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLinea" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fechaJuego" DATE NOT NULL,
    "hora" INTEGER NOT NULL,
    "numeroAnimal" TEXT NOT NULL,
    "nombreAnimalSnapshot" TEXT NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketLinea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_numeroVisible_key" ON "Ticket"("numeroVisible");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_codigoPublico_key" ON "Ticket"("codigoPublico");

-- CreateIndex
CREATE INDEX "Ticket_fechaJuego_idx" ON "Ticket"("fechaJuego");

-- CreateIndex
CREATE INDEX "Ticket_estado_fechaJuego_idx" ON "Ticket"("estado", "fechaJuego");

-- CreateIndex
CREATE INDEX "Ticket_vendedorId_createdAt_idx" ON "Ticket"("vendedorId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketLinea_fechaJuego_hora_numeroAnimal_idx" ON "TicketLinea"("fechaJuego", "hora", "numeroAnimal");

-- CreateIndex
CREATE INDEX "TicketLinea_fechaJuego_hora_idx" ON "TicketLinea"("fechaJuego", "hora");

-- CreateIndex
CREATE UNIQUE INDEX "TicketLinea_ticketId_hora_numeroAnimal_key" ON "TicketLinea"("ticketId", "hora", "numeroAnimal");

-- AddForeignKey
ALTER TABLE "TicketLinea" ADD CONSTRAINT "TicketLinea_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLinea" ADD CONSTRAINT "TicketLinea_numeroAnimal_fkey" FOREIGN KEY ("numeroAnimal") REFERENCES "Animal"("numero") ON DELETE RESTRICT ON UPDATE CASCADE;
