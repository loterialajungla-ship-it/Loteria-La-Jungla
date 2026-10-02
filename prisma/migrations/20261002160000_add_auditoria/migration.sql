-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM (
  'LOGIN',
  'LOGOUT',
  'CREAR_TICKET',
  'ANULAR_TICKET',
  'CREAR_VENDEDOR',
  'ACTIVAR_VENDEDOR',
  'DESACTIVAR_VENDEDOR',
  'RESET_PASSWORD',
  'CAMBIAR_PASSWORD',
  'CREAR_RESULTADO',
  'MODIFICAR_RESULTADO'
);

-- CreateEnum
CREATE TYPE "EntidadAuditoria" AS ENUM (
  'TICKET',
  'USUARIO',
  'RESULTADO',
  'AUTH'
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "entidad" "EntidadAuditoria" NOT NULL,
    "entidadId" TEXT NOT NULL,
    "detalle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Auditoria_createdAt_idx" ON "Auditoria"("createdAt");

-- CreateIndex
CREATE INDEX "Auditoria_usuarioId_createdAt_idx" ON "Auditoria"("usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "Auditoria_accion_createdAt_idx" ON "Auditoria"("accion", "createdAt");

-- CreateIndex
CREATE INDEX "Auditoria_entidad_createdAt_idx" ON "Auditoria"("entidad", "createdAt");

-- CreateIndex
CREATE INDEX "Auditoria_entidadId_createdAt_idx" ON "Auditoria"("entidadId", "createdAt");

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
