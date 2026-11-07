-- C5: CajaAplicacion (FIFO). Sin backfill de confirmaciones históricas.
-- Las confirmaciones previas a C5, si existen, quedan sin aplicaciones;
-- solo las nuevas confirmaciones distribuyen vía servicio.

-- CreateTable
CREATE TABLE "CajaAplicacion" (
    "id" TEXT NOT NULL,
    "confirmacionId" TEXT NOT NULL,
    "obligacionId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "importeAplicado" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaAplicacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CajaAplicacion_importe_positive" CHECK ("importeAplicado" > 0)
);

-- Indexes / uniqueness (una aplicación por par confirmación×obligación)
CREATE UNIQUE INDEX "CajaAplicacion_confirmacionId_obligacionId_key"
ON "CajaAplicacion"("confirmacionId", "obligacionId");

CREATE INDEX "CajaAplicacion_obligacionId_createdAt_idx"
ON "CajaAplicacion"("obligacionId", "createdAt");

CREATE INDEX "CajaAplicacion_confirmacionId_createdAt_idx"
ON "CajaAplicacion"("confirmacionId", "createdAt");

CREATE INDEX "CajaAplicacion_vendedorId_createdAt_idx"
ON "CajaAplicacion"("vendedorId", "createdAt");

-- FKs
ALTER TABLE "CajaAplicacion"
ADD CONSTRAINT "CajaAplicacion_confirmacionId_fkey"
FOREIGN KEY ("confirmacionId") REFERENCES "CajaConfirmacion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CajaAplicacion"
ADD CONSTRAINT "CajaAplicacion_obligacionId_fkey"
FOREIGN KEY ("obligacionId") REFERENCES "CajaObligacion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CajaAplicacion"
ADD CONSTRAINT "CajaAplicacion_vendedorId_fkey"
FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridad vendedor: confirmación.declaración.vendedor == obligación.vendedor == fila.vendedorId
CREATE OR REPLACE FUNCTION caja_aplicacion_validar_vendedor()
RETURNS TRIGGER AS $$
DECLARE
  v_decl TEXT;
  v_obl TEXT;
BEGIN
  SELECT d."vendedorId" INTO v_decl
  FROM "CajaConfirmacion" c
  INNER JOIN "CajaDeclaracion" d ON d.id = c."declaracionId"
  WHERE c.id = NEW."confirmacionId";

  IF v_decl IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: confirmacion o declaracion inexistente'
      USING ERRCODE = '23514';
  END IF;

  SELECT o."vendedorId" INTO v_obl
  FROM "CajaObligacion" o
  WHERE o.id = NEW."obligacionId";

  IF v_obl IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: obligacion inexistente'
      USING ERRCODE = '23514';
  END IF;

  IF v_decl <> v_obl THEN
    RAISE EXCEPTION 'CajaAplicacion: vendedor de confirmacion y obligacion no coinciden'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."vendedorId" IS DISTINCT FROM v_decl THEN
    RAISE EXCEPTION 'CajaAplicacion: vendedorId inconsistente con confirmacion/obligacion'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER caja_aplicacion_validar_vendedor_bi
BEFORE INSERT ON "CajaAplicacion"
FOR EACH ROW
EXECUTE PROCEDURE caja_aplicacion_validar_vendedor();

-- No superar importeConfirmado ni importeAdmin (defensa en profundidad)
CREATE OR REPLACE FUNCTION caja_aplicacion_validar_cupos()
RETURNS TRIGGER AS $$
DECLARE
  lim_conf DECIMAL(12,2);
  lim_obl DECIMAL(12,2);
  sum_conf DECIMAL(12,2);
  sum_obl DECIMAL(12,2);
BEGIN
  SELECT c."importeConfirmado" INTO lim_conf
  FROM "CajaConfirmacion" c
  WHERE c.id = NEW."confirmacionId"
  FOR SHARE;

  IF lim_conf IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: confirmacion inexistente'
      USING ERRCODE = '23514';
  END IF;

  SELECT o."importeAdmin" INTO lim_obl
  FROM "CajaObligacion" o
  WHERE o.id = NEW."obligacionId"
  FOR SHARE;

  IF lim_obl IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: obligacion inexistente'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(a."importeAplicado"), 0) INTO sum_conf
  FROM "CajaAplicacion" a
  WHERE a."confirmacionId" = NEW."confirmacionId";

  IF sum_conf + NEW."importeAplicado" > lim_conf THEN
    RAISE EXCEPTION 'CajaAplicacion: suma supera importeConfirmado'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(a."importeAplicado"), 0) INTO sum_obl
  FROM "CajaAplicacion" a
  WHERE a."obligacionId" = NEW."obligacionId";

  IF sum_obl + NEW."importeAplicado" > lim_obl THEN
    RAISE EXCEPTION 'CajaAplicacion: suma supera importeAdmin de obligacion'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER caja_aplicacion_validar_cupos_bi
BEFORE INSERT ON "CajaAplicacion"
FOR EACH ROW
EXECUTE PROCEDURE caja_aplicacion_validar_cupos();

-- Inmutabilidad ordinaria: bloquear UPDATE (DELETE permitido solo para cleanup/FKs de test)
CREATE OR REPLACE FUNCTION caja_aplicacion_reject_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CajaAplicacion es inmutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER caja_aplicacion_reject_update
BEFORE UPDATE ON "CajaAplicacion"
FOR EACH ROW
EXECUTE PROCEDURE caja_aplicacion_reject_update();
