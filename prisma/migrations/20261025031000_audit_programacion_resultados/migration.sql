-- AlterEnum AccionAuditoria: eventos de programación de resultados.
ALTER TYPE "AccionAuditoria" ADD VALUE 'PROGRAMAR_RESULTADO';
ALTER TYPE "AccionAuditoria" ADD VALUE 'MODIFICAR_PROGRAMACION';
ALTER TYPE "AccionAuditoria" ADD VALUE 'CANCELAR_PROGRAMACION';

-- AlterEnum EntidadAuditoria
ALTER TYPE "EntidadAuditoria" ADD VALUE 'RESULTADO_PROGRAMADO';
