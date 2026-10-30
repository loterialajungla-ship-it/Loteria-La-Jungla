-- Bootstrap idempotente de CreditosConfig (singleton id=1).
-- No activa el control. No fija inicioEn. No toca saldos ni movimientos.
-- Si la fila ya existe, no modifica ningún campo.

INSERT INTO "CreditosConfig"
  ("id", "controlActivo", "inicioEn", "umbralSaldoBajo", "updatedAt", "updatedByAdminId")
VALUES
  (1, false, NULL, NULL, NOW(), NULL)
ON CONFLICT ("id") DO NOTHING;
