-- Contadores de fuerza bruta del login (HMAC, no IP en claro)
-- y auditoría de intentos fallidos.

CREATE TABLE "LoginRateBucket" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginRateBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "LoginRateBucket_windowStart_idx" ON "LoginRateBucket"("windowStart");

ALTER TYPE "AccionAuditoria" ADD VALUE 'LOGIN_FALLIDO';
