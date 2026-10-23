-- CreateEnum
CREATE TYPE "OrigenResultado" AS ENUM ('MANUAL', 'AUTOMATICO');

-- AlterTable Resultado: origen (existentes = MANUAL)
ALTER TABLE "Resultado" ADD COLUMN "origen" "OrigenResultado" NOT NULL DEFAULT 'MANUAL';

-- AlterTable Auditoria: usuarioId opcional (eventos de sistema)
ALTER TABLE "Auditoria" ALTER COLUMN "usuarioId" DROP NOT NULL;
