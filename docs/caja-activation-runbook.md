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
