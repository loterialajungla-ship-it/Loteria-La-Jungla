-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyRequestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_idempotencyKey_key" ON "Ticket"("idempotencyKey");
