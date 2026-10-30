# Runbook operativo — Bootstrap de CreditosConfig

**Alcance:** inicializar de forma segura la fila singleton `CreditosConfig(id=1)` en TEST o producción.  
**No es un deploy.** No activa el control de créditos. No asigna ni retira saldos.  
**Relacionado:** migración `20261030140000_creditos_config_bootstrap`, comando `npm run credits:ensure-config`.

---

## 0. Principios

| Regla | Detalle |
| --- | --- |
| Fail-closed | Sin fila persistida, ventas de **VENDEDOR** fallan (`CREDITOS_CONFIG_INCOMPLETE`). |
| Defaults virtuales ≠ apagado | `getConfig` puede devolver `controlActivo=false` con `configPersisted=false`; eso **no** es control desactivado. |
| Bootstrap explícito | Migración y/o `credits:ensure-config`. **Nunca** desde `getConfig`. |
| Sin secretos en logs | No imprimir URLs, hosts completos con credenciales ni connection strings. |
| Autorización independiente | Activar control / fijar `inicioEn` / mutar saldos = procedimientos **distintos** y posteriores. |

---

## 1. Identificar el entorno

| Entorno | Endpoint Neon (ID) | Uso |
| --- | --- | --- |
| TEST | `ep-muddy-fire-b44816w0` | Validación previa, smoke, preparación |
| Producción | `ep-spring-silence-b40xhu8w` | Solo tras validar TEST |
| Recovery / dev-recovery | otros IDs allowlisted | **Prohibidos** para este bootstrap |

Comprobar el ID de endpoint de la connection string **sin pegar la URL en tickets/chats**. Extraer solo el segmento `ep-…`.

Variables genéricas (`DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL`) **no** alimentan el comando `credits:ensure-config`.

---

## 2. Aplicar migraciones

Orden relevante:

1. `…_add_vendedor_creditos` — crea tabla `CreditosConfig` (sin INSERT).
2. `…_credito_correccion_origen_uidx` — índice.
3. `20261030140000_creditos_config_bootstrap` — `INSERT … ON CONFLICT DO NOTHING`.

### TEST

1. Confirmar connection string → endpoint TEST.
2. Aplicar migraciones pendientes con el flujo Prisma habitual del proyecto (`migrate deploy` / proceso ya documentado), **solo** contra TEST.
3. No ejecutar seeds de producción.

### Producción

1. Ventana de cambio autorizada.
2. Connection string → endpoint PRODUCTION.
3. Aplicar las mismas migraciones.
4. La migración de bootstrap **no** activa el control ni fija `inicioEn`.

**Esta fase de implementación no ejecuta migraciones.** El operador las aplica en un paso autorizado posterior.

---

## 3. Comprobar la fila singleton

Consulta de solo lectura (ejecutar el operador en su consola segura):

```sql
SELECT "id", "controlActivo", "inicioEn", "umbralSaldoBajo", "updatedAt", "updatedByAdminId"
FROM "CreditosConfig"
WHERE "id" = 1;
```

| Resultado | Interpretación |
| --- | --- |
| 0 filas | Configuración ausente → ventas VENDEDOR fail-closed |
| 1 fila | Persistida; revisar `controlActivo` / `inicioEn` |

---

## 4. Bootstrap en una base ya migrada (sin re-migrar)

Si la tabla existe pero la fila falta (p. ej. migración de tabla aplicada antes de existir el bootstrap):

### TEST

```powershell
$env:CREDITS_ENSURE_TARGET="test"
$env:CREDITS_ENSURE_DATABASE_URL="<url-solo-endpoint-TEST>"
npm run credits:ensure-config -- --dry-run   # no escribe
npm run credits:ensure-config               # inserta si falta
```

### Producción (doble opt-in)

```powershell
$env:CREDITS_ENSURE_TARGET="production"
$env:CREDITS_ENSURE_PRODUCTION="1"
$env:CONFIRM_CREDITS_ENSURE_PRODUCTION="I_UNDERSTAND_THIS_WRITES_PRODUCTION"
$env:CREDITS_ENSURE_DATABASE_URL="<url-solo-endpoint-PRODUCTION>"
npm run credits:ensure-config -- --dry-run
npm run credits:ensure-config
```

Comportamiento:

- Si la fila **existe** → exit 0, **cero** campos modificados.
- Si **falta** → inserta `controlActivo=false`, `inicioEn=NULL`, `umbralSaldoBajo=NULL`, `updatedByAdminId=NULL`.
- Idempotente (`ON CONFLICT DO NOTHING`).

---

## 5. Comprobar `controlActivo = false`

```sql
SELECT "controlActivo" FROM "CreditosConfig" WHERE "id" = 1;
-- Esperado tras bootstrap: false
```

---

## 6. Comprobar `inicioEn IS NULL`

```sql
SELECT "inicioEn" FROM "CreditosConfig" WHERE "id" = 1;
-- Esperado tras bootstrap: NULL
```

---

## 7. Verificar que no cambiaron cuentas ni movimientos

Antes/después del bootstrap (o dry-run + real):

```sql
SELECT COUNT(*) AS cuentas FROM "VendedorCreditoCuenta";
SELECT COUNT(*) AS movimientos FROM "CreditoMovimiento";
SELECT COALESCE(SUM("saldoDisponible"), 0) AS suma_saldos FROM "VendedorCreditoCuenta";
```

Los tres deben ser **idénticos** tras `credits:ensure-config`. El comando no toca esas tablas.

---

## 8. Smoke tests (post-bootstrap, control aún apagado)

1. **ADMIN** GET `/api/admin/creditos` → `config.configPersisted === true`, `controlActivo === false`.
2. UI admin → mensaje «Control de créditos desactivado.» (no «no inicializada»).
3. **VENDEDOR** emite ticket de prueba en TEST → venta OK, **sin** `CONSUMO_VENTA`.
4. Sin fila (solo en laboratorio) → VENDEDOR recibe error fail-closed / 503 `CREDITOS_CONFIG_INCOMPLETE`.

No activar el control en este smoke.

### Obligatorio tras migrar créditos (H1 — sin cambiar política ADMIN)

Tras aplicar las migraciones de créditos en un entorno, el smoke de **VENDEDOR** es **obligatorio** antes de dar por válido el entorno:

- Login VENDEDOR activo → emitir ticket de prueba.
- Confirmar respuesta OK y (con control apagado) ausencia de `CONSUMO_VENTA`.
- ADMIN sigue exento de consumo; **no** se introduce fail-closed para ventas ADMIN.

Sin ese smoke VENDEDOR no se debe activar el control ni promover el entorno.

---

## 9. Preparar saldos

Con fila persistida y `controlActivo=false`:

1. UI `/admin/creditos` o API de asignación (solo ADMIN).
2. Asignar saldos iniciales por vendedor.
3. Verificar movimientos `ASIGNACION` y saldos.

Sigue **sin** consumir créditos en ventas mientras el control esté apagado o falte `inicioEn` efectivo.

---

## 10. Fijar `inicioEn` y activar el control (autorización independiente)

**No** forma parte del bootstrap.

1. Autorización explícita de negocio/operaciones.
2. ADMIN: fijar `inicioEn` (instante America/Caracas → ISO) vía UI/API.
3. Confirmar saldos preparados.
4. Activar `controlActivo=true` (el dominio exige `inicioEn` no nulo).
5. Smoke: VENDEDOR con ticket ≥ `inicioEn` consume; ADMIN exento.

Revertir/apagar el control es otro cambio autorizado; no re-ejecutar bootstrap para “arreglar” estado.

---

## Diferencias TEST vs producción

| Paso | TEST | Producción |
| --- | --- | --- |
| Destino | `CREDITS_ENSURE_TARGET=test` | `=production` + `CREDITS_ENSURE_PRODUCTION=1` + frase de confirmación |
| Endpoint | solo TEST | solo PRODUCTION |
| URL del comando | `CREDITS_ENSURE_DATABASE_URL` | misma variable, otro endpoint |
| Objetivo | validar procedimiento | mismo SQL/comando tras evidencia en TEST |
| Activar control | opcional en laboratorio | solo con autorización de go-live de créditos |

---

## Códigos de salida del comando

| Código | Significado |
| --- | --- |
| 0 | OK (insertado, o ya existía sin cambios, o dry-run) |
| 2 | Guardas / destino / URL / opt-in |
| 3 | Verificación post-insert fallida |
| 1 | Error inesperado (sin detalles internos) |

---

## Qué no hacer

- No usar este runbook para seeds, bootstrap de ADMIN o deploy Vercel.
- No pasar `DATABASE_URL`/`DIRECT_URL` al comando como atajo.
- No interpretar `configPersisted=false` como «control off».
- No inicializar desde la UI admin (no hay acción de bootstrap en pantalla).
