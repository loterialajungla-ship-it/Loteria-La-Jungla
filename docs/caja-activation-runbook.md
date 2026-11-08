# Runbook Caja — despliegue y activación (C7.2)

**Estado:** procedimiento versionado. **No ejecutado** en C7.2.  
**Relacionado:** `docs/production-deployment-runbook.md`, `docs/caja-deploy-isolation-inventory.md`  
**Script de activación:** `scripts/activate-caja-production.ts` (`npm run activate:caja:production`)

---

## 0. Política operativa

- **No hay anulaciones ni devoluciones** de tickets (C7.2).
- Caja permanece **inactiva** hasta autorización expresa posterior a migraciones + deploy.
- Premios y créditos son independientes de Caja.
- No existe endpoint HTTP de activación.

---

## 1. Revisar repositorio

1. Confirmar rama y HEAD revisados.
2. Usar el inventario `docs/caja-deploy-isolation-inventory.md` para incluir solo Caja + prohibición de anulaciones + dependencias mínimas.
3. Excluir WIP ajeno (resultados auto, auditoría no-Caja, etc.) salvo dependencia documentada.
4. Code review del paquete a desplegar.
5. `tsc` / lint / build / tests Caja en verde.

## 2. Backup y recuperación Neon

1. Snapshot / branch / backup de producción documentado.
2. Confirmar procedimiento de restore **antes** de migrar.
3. No asumir down-migration segura tras datos reales.

## 3. Confirmar endpoint de producción

- Endpoint allowlisted: `ep-spring-silence-b40xhu8w` (PRODUCTION).
- Rechazar TEST (`ep-muddy-fire-b44816w0`), recovery y hosts desconocidos.
- No imprimir URLs ni credenciales.

## 4. Desplegar código con Caja inactiva

1. Desplegar build que incluye modelos/APIs/UI de Caja.
2. Default de dominio: sin fila o `activa=false` → sin obligaciones nuevas.
3. Verificar que la app arranca y rutas `/admin/caja`, `/venta/caja` responden (consulta).

## 5. Migraciones Caja (orden exacto)

Aplicar **solo** tras autorización y backup, en producción:

1. `20261106223000_add_caja_comisiones`
2. `20261106230000_add_caja_obligacion`
3. `20261107010000_add_caja_declaraciones_confirmaciones`
4. `20261107020000_add_caja_aplicacion`
5. `20261107021000_caja_aplicacion_cupos_for_update`

Comando típico (operador autorizado, URLs de prod): `npx prisma migrate deploy`

## 6. Verificar migraciones y tablas

- `_prisma_migrations` contiene las cinco.
- Tablas: `CajaConfig`, `VendedorComision`, `VendedorComisionHistorial`, `CajaObligacion`, `CajaDeclaracion`, `CajaConfirmacion`, `CajaAplicacion`.
- Triggers C5.1 presentes.

## 7. Verificar Caja inactiva

- `CajaConfig` ausente o `activa=false`, `activadaEn=null`.
- UI muestra estado inactivo; **no** activar desde pantallas.

## 8. Smoke de permisos (sin movimientos falsos)

- ADMIN: ve `/admin/caja`, no puede anular tickets (403).
- VENDEDOR: ve `/venta/caja` propia; no ve admin Caja; no anula.
- No crear tickets de prueba de alto importe “por probar”.

## 9. Autorización expresa para activar

Obtener autorización escrita/operativa. Sin ella, **detenerse**.

## 10. Ejecutar activación controlada

```text
ACTIVATE_CAJA_TARGET=production
CONFIRM_PRODUCTION_ACTIVATE_CAJA=I_UNDERSTAND_THIS_ACTIVATES_CAJA_IN_PRODUCTION
DATABASE_URL=…   # solo PRODUCTION
DIRECT_URL=…     # solo PRODUCTION
ACTIVATE_CAJA_ADMIN_USER_ID=<cuid ADMIN>   # obligatorio si hay >1 ADMIN activo
npm run activate:caja:production
```

El script:

- Valida dual opt-in + allowlist PRODUCTION (rechaza TEST).
- Invoca `activarCaja` (idempotente).
- Imprime `activa`, `activadaEn` UTC, comisiones inicializadas.
- Exit ≠ 0 ante cualquier condición insegura.

## 11. Verificar post-activación

- `activa=true` y `activadaEn` UTC registrado.
- Vendedores sin comisión → 20 %; con comisión previa → conservada.
- Alta de vendedor nuevo → 20 % (misma TX de creación).

## 12. Primera venta real autorizada

- Emitir una venta elegible.
- Confirmar 1 `CajaObligacion` con snapshot.
- Créditos consumidos del **actor**, no del atribuido (si ADMIN atribuye).

---

## Contingencias

| Situación | Acción |
|-----------|--------|
| Fallo migrate pre-datos | Restore backup; no activar |
| Fallo post-migrate, pre-activar | Código puede quedar; Caja inactiva = seguro |
| Fallo en script de activación | Revisar logs; reintento idempotente si no quedó activa |
| Tras ventas reales | **No** down-migrate; desactivación operativa = `activa=false` (no borra obligaciones) |
| Rollback de código | Independiente del esquema; no elimina tablas/enums |

Separar siempre: revert código ≠ recuperación esquema ≠ recuperación datos ≠ apagado operativo.

---

## C7.4-B — Activación (no ejecutar en C7.4-A)

Tres fases distintas. Esta sección solo describe la activación. No la ejecuta.

### A. Preparación (ya hecha en C7.3 / C7.4-A)

Deben cumplirse todas antes de activar:

1. Código de producción = merge `24ec842` (o un sucesor que no cambie la semántica de Caja).
2. Las cinco migraciones Caja aplicadas y sin rollback.
3. `CajaConfig` ausente o `activa=false` y `activadaEn` null.
4. Cero filas en comisiones, obligaciones, declaraciones, confirmaciones y aplicaciones.
5. Endpoint allowlisted `ep-spring-silence-b40xhu8w`. Rechazar TEST `ep-muddy-fire-b44816w0`.
6. Punto de recuperación **posterior a las migraciones y anterior a la activación**. El marcador `0/15933640` (2026-11-07 20:26:55 UTC) es el estado **anterior a las migraciones**. Restaurar producción a ese LSN elimina el esquema Caja. No usarlo como rollback de la activación.
7. Smoke ADMIN y VENDEDOR de solo lectura en verde, o aceptación explícita de dejarlo pendiente.
8. Autorización escrita de C7.4-B. Sin ella, detenerse.

### B. Activación

1. Confirmar `DATABASE_URL` y `DIRECT_URL` resuelven a `ep-spring-silence-b40xhu8w` y coinciden. No imprimir URLs.
2. Lectura previa: vendedores con rol `VENDEDOR` (activos e inactivos) y filas de `VendedorComision`.
3. Si hay más de un ADMIN activo, definir `ACTIVATE_CAJA_ADMIN_USER_ID`. Si hay uno solo, el script lo resuelve.
4. Dual opt-in exacto, y solo entonces:

```text
ACTIVATE_CAJA_TARGET=production
CONFIRM_PRODUCTION_ACTIVATE_CAJA=I_UNDERSTAND_THIS_ACTIVATES_CAJA_IN_PRODUCTION
npm run activate:caja:production
```

5. El guard corre antes de `activarCaja`. Sin las dos variables, exit 1 y cero escrituras.
6. `activarCaja` corre en una sola transacción: crea `CajaConfig` si falta, pone `activa=true`, `activadaEn` UTC, `activadaPorAdminId`, e inserta 20 % solo donde no hay comisión. No toca créditos, tickets ni obligaciones.
7. Registrar la salida: `activa`, `activadaEnUtc`, `alreadyActive`, `comisionesInicializadas`.
8. Retirar del entorno `ACTIVATE_CAJA_TARGET`, `CONFIRM_PRODUCTION_ACTIVATE_CAJA` y `ACTIVATE_CAJA_ADMIN_USER_ID`.

Si el proceso muere después del commit, la transacción ya quedó. Un reintento es idempotente: no cambia `activadaEn` ni recrea comisiones existentes.

### C. Verificación inmediata (aún sin venta)

1. Una fila `CajaConfig`: `activa=true`, `activadaEn` no null.
2. Cada usuario `rol=VENDEDOR` sin comisión previa queda en 20 %, con historial `porcentajeAnterior` null y `changedByAdminId` del actor.
3. Porcentajes que ya existían no cambian.
4. Cero obligaciones, declaraciones, confirmaciones y aplicaciones.
5. Conteos de `Ticket` y `CreditoMovimiento` iguales a los de antes de activar.
6. Un vendedor creado después, con Caja ya activa, recibe 20 % en la misma transacción de alta.

### D. Primera venta real (después de la verificación)

No forma parte de la activación. Requiere autorización aparte.

1. Emitir una venta elegible real.
2. Confirmar exactamente una `CajaObligacion` con snapshot de porcentaje e importes.
3. El crédito lo consume el actor, no el vendedor atribuido cuando un ADMIN vende a nombre de otro.

### Contingencia de la activación

| Situación | Acción |
|-----------|--------|
| Guard rechaza el destino | No hay escritura. Corregir endpoint y no reintentar a ciegas. |
| Fallo dentro de la transacción | Rollback de Postgres. Caja sigue inactiva. Revisar el error y reintentar solo con autorización. |
| Exit ≠ 0 después de `Caja activación OK` ausente | Leer `CajaConfig` antes de reintentar. Si `activa=true`, no volver a lanzar el script. |
| Activación correcta pero se quiere apagar | `activa=false` operativo. No borra comisiones ni obligaciones. No down-migrate. |
| Hace falta el esquema previo a Caja | Solo entonces el LSN `0/15933640`, y solo con autorización explícita de perder el esquema Caja. |
