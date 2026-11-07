-- C5.1: Serializar cupos de CajaAplicacion bajo READ COMMITTED.
-- FOR SHARE no impedía INSERT concurrentes en hijos; FOR UPDATE sobre padres sí.
-- Orden de locks del trigger (obligatorio): CajaConfirmacion → CajaObligacion.
-- Tras adquirir cada FOR UPDATE, el SUM se ejecuta en sentencias posteriores
-- para ver filas committed por la TX que liberó el lock.

CREATE OR REPLACE FUNCTION caja_aplicacion_validar_cupos()
RETURNS TRIGGER AS $$
DECLARE
  lim_conf DECIMAL(12,2);
  lim_obl DECIMAL(12,2);
  sum_conf DECIMAL(12,2);
  sum_obl DECIMAL(12,2);
BEGIN
  -- 1) Lock exclusivo de la confirmación (serializa inserciones sobre el mismo padre).
  SELECT c."importeConfirmado" INTO lim_conf
  FROM "CajaConfirmacion" c
  WHERE c.id = NEW."confirmacionId"
  FOR UPDATE;

  IF lim_conf IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: confirmacion inexistente'
      USING ERRCODE = '23514';
  END IF;

  -- 2) Lock exclusivo de la obligación (mismo orden siempre: conf → obl).
  SELECT o."importeAdmin" INTO lim_obl
  FROM "CajaObligacion" o
  WHERE o.id = NEW."obligacionId"
  FOR UPDATE;

  IF lim_obl IS NULL THEN
    RAISE EXCEPTION 'CajaAplicacion: obligacion inexistente'
      USING ERRCODE = '23514';
  END IF;

  -- 3) SUM tras los locks: bajo READ COMMITTED, tras esperar FOR UPDATE,
  --    esta consulta ve las aplicaciones ya committed por la TX precedente.
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
