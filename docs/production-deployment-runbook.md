# Runbook de despliegue a producción — Lotería La Jungla V1

**Fecha:** 2026-10-02  
**Alcance:** procedimiento operativo. **No** es un deploy ejecutado.  
**Relacionado:** `docs/production-preflight.md`, `docs/v1-final-status.md`  
**Stack:** Next.js 14 · Vercel · PostgreSQL/Neon · Prisma 5

---

## 1. Requisitos

| Requisito | Detalle |
| --- | --- |
| Código | Commit V1 cerrado (build/preflight PASS) |
| Hosting | Vercel (o equivalente) con Node para `next build` |
| DB | Neon PostgreSQL (o Postgres compatible) |
| Dominio | HTTPS obligatorio |
| Operador | Acceso a Vercel env + Neon + CLI local con `DATABASE_URL`/`DIRECT_URL` de **prod** solo cuando se apliquen migraciones/bootstrap |

### Qué necesita Vercel para `npm run build`

Definido en `package.json`:

```text
postinstall → prisma generate
build       → prisma generate && next build
```

- `binaryTargets` Prisma incluyen `native` y `rhel-openssl-3.0.x` (adecuado a Vercel Linux).
- `next.config.mjs` no añade pasos de seed/test.
- **No** se ejecutan en build: `seed:manual-test`, `test:integration`, `test:acceptance`, `dev:test`, `dev:test:lan`, `bootstrap:admin`.

Variables **mínimas en el entorno de build/runtime** de Production:

- `DATABASE_URL`
- `DIRECT_URL`

(Prisma las exige en `schema.prisma`.)

---

## 2. Variables

### Runtime (obligatorias en Production)

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Prisma → conexiones pooled (Neon “pooled”) |
| `DIRECT_URL` | Prisma `directUrl` → migraciones / conexión directa Neon |

### Runtime (opcional)

| Variable | Uso | Default |
| --- | --- | --- |
| `AUTH_SESSION_HOURS` | Duración de `lj_session` | `12` (tope interno 168) |

### Solo bootstrap (provisionamiento, no runtime diario)

| Variable | Uso |
| --- | --- |
| `ADMIN_BOOTSTRAP_USER` | Usuario del primer ADMIN (default `admin`) |
| `ADMIN_BOOTSTRAP_PASSWORD` | Contraseña del bootstrap (mín. 8; se hashea; **no** se imprime) |

Tras existir al menos un ADMIN, estas variables **dejan de ser necesarias** para que la app funcione. Pueden retirarse del entorno de Vercel o guardarse solo en un vault de operaciones para re-ejecutar el script en emergencia (el script **no** crea un segundo ADMIN si ya existe uno).

### No usar en Production runtime

| Variable / cookie | Motivo |
| --- | --- |
| `TEST_DATABASE_URL` | Solo tests / `dev:test` / seed manual |
| `MANUAL_TEST_*` | Solo seed manual |
| `ADMIN_PASSWORD` | Legacy; runtime no autentica con ella |
| `ADMIN_SESSION_SECRET` | Legacy |
| Cookie `admin_session` | No es mecanismo válido |

**Nunca documentar valores reales de secretos en este archivo.**

### Neon — convención de URLs

- `DATABASE_URL`: connection string **runtime** (típicamente pooler Neon).  
- `DIRECT_URL`: connection string **directa** (sin pooler), usada por Prisma para migraciones y operaciones que lo requieren.

No mezclar la branch/DB de TEST con Production.

---

## 3. Backup

**Antes** de `prisma migrate deploy` en producción:

1. Realizar un **backup verificable** de PostgreSQL/Neon (snapshot / export según el panel Neon).  
2. Confirmar que el backup es restaurable (o al menos que Neon lo marca como completo).  

Este runbook **no** ejecuta backups automáticamente.

---

## 4. Migraciones

### Migraciones actuales (orden acumulativo)

1. `20260925010837_init`  
2. `20260930232404_add_tickets_models`  
3. `20261001002140_add_users_and_sessions`  
4. `20261002012244_add_ticket_idempotency`  
5. `20261002160000_add_auditoria`  

### Comando correcto (producción)

Desde una máquina/CI con las URLs de **producción** (no TEST):

```bash
npx prisma migrate deploy
```

Esto aplica migraciones pendientes de forma acumulativa.

### Prohibido en producción

```bash
npx prisma migrate reset   # NO
```

No borrar tablas, no resetear schema, no ejecutar seeds de test.

### `prisma generate`

- Automático en `postinstall` y en `npm run build`.  
- No sustituye a `migrate deploy`.

---

## 5. Vercel

### Environments

| Entorno | Uso | Variables |
| --- | --- | --- |
| **Production** | Dominio real | `DATABASE_URL`, `DIRECT_URL`, opcional `AUTH_SESSION_HOURS` de **prod** |
| **Preview** | PRs / pruebas | Preferible DB **aislada** (branch Neon); **no** copiar secretos de prod a ciegas; no usar datos reales de clientes |
| **Development** | Local | `.env` local; puede tener TEST; **no** es Production |

No copiar secretos de Development a Production.  
No poner `TEST_DATABASE_URL` como dependencia del runtime de Production.

### Framework

- Framework Preset: Next.js  
- Build Command: `npm run build` (default del `package.json`)  
- Install: `npm install` (dispara `postinstall` → `prisma generate`)  
- Output: estándar Next (App Router)

### Preview

Recomendado desplegar **Preview** primero si hay una DB de preview aislada.  
Limitaciones: Preview **no** sustituye pruebas contra la DB real de producción; no ejecutar `test:integration`/`acceptance` contra prod.

---

## 6. Bootstrap ADMIN

Cuando la DB de producción **aún no** tiene un Usuario ADMIN:

1. Configurar temporalmente (local o Vercel env / shell):  
   - `DATABASE_URL` / `DIRECT_URL` de prod  
   - `ADMIN_BOOTSTRAP_USER`  
   - `ADMIN_BOOTSTRAP_PASSWORD`  
2. Ejecutar:

```bash
npm run bootstrap:admin
```

Comportamiento del script:

- Hashea la contraseña (bcrypt); **no** imprime password ni hash.  
- Si ya existe un ADMIN, **no** crea otro.  
- No usa `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`.

Después del primer ADMIN:

- Crear vendedores desde `/admin/usuarios`.  
- Retirar o rotar `ADMIN_BOOTSTRAP_*` del entorno según política de secretos.

---

## 7. Login

| Ruta | Comportamiento |
| --- | --- |
| `/login` | Formulario **único** oficial |
| `/admin/login` | Redirect **308** → `/login` |
| ADMIN tras login | `/admin` |
| VENDEDOR tras login | `/venta` |
| Logout | → `/login` |

Cookie de sesión: `lj_session`

| Atributo | Valor |
| --- | --- |
| httpOnly | sí |
| SameSite | Lax |
| path | `/` |
| secure | sí en `NODE_ENV=production` |
| maxAge | según `AUTH_SESSION_HOURS` |

---

## 8. Roles (prueba post-deploy)

### ADMIN debe poder

- `/admin`, `/admin/tickets`, `/admin/usuarios`, `/admin/reportes`, `/admin/auditoria`  
- `/venta`  
- APIs admin (resultados, exposición, anulación, etc.)

### VENDEDOR debe poder

- `/venta`, `/venta/tickets`, `/perfil`  
- Solo tickets propios  

### VENDEDOR no debe acceder a

- `/admin`, `/admin/tickets`, `/admin/usuarios`, `/admin/reportes`, `/admin/auditoria`  
  (layout/middleware/API → redirect o 403)

---

## 9. Orden de despliegue recomendado

Justificación: Vercel construye la app con Prisma Client, pero **`migrate deploy` no corre en el build**. Las migraciones deben aplicarse a la DB de prod **antes** (o en un paso explícito de release) de que el tráfico use el nuevo código que asume el schema actual. El bootstrap ADMIN es **después** de migraciones.

1. **Backup** verificable de Neon/Postgres prod.  
2. Confirmar **rama/commit** a desplegar.  
3. Configurar variables en Vercel **Production** (`DATABASE_URL`, `DIRECT_URL`, opcional `AUTH_SESSION_HOURS`).  
4. Aplicar migraciones a prod: `npx prisma migrate deploy` (con URLs de prod; desde CI/local controlado).  
5. **Deploy** Production en Vercel (build = `prisma generate && next build`).  
6. Crear/verificar ADMIN: `npm run bootstrap:admin` si no existe.  
7. Probar `/login` (ADMIN → `/admin`).  
8. Crear VENDEDOR desde admin; probar login VENDEDOR → `/venta`.  
9. Ticket de prueba controlado (importe mínimo / hora abierta).  
10. PNG + QR + `/ticket/[codigo]`.  
11. Resultado de prueba **solo** si se puede hacer sin dañar operación real (ver §11).  
12. Exposición / reportes / auditoría (lectura ADMIN).  
13. Logout.  
14. Limpieza legacy env (ver §17).

Si el equipo prefiere migrar **justo después** del deploy: aceptar un breve momento en que el código nuevo exista sin columnas nuevas (riesgo). **Preferir migrar antes** cuando el schema ya está en el commit a desplegar.

---

## 10. Primera venta / ticket de prueba (post-deploy)

Objetivo: validar el flujo sin volumen real.

1. Login VENDEDOR → `/venta`.  
2. Elegir **una** hora abierta y **un** animal.  
3. Importe **mínimo** acordado operativamente (p. ej. el menor permitido por reglas actuales).  
4. Crear ticket; revisar preview.  
5. Descargar PNG; comprobar QR visible.  
6. Abrir/escanear QR → `/ticket/[codigoPublico]` en el **dominio de producción** (`window.location.origin`).  
7. Confirmar datos jugados; sin 30×/exposición en el PNG.

**No** anular en masa ni cargar importes altos “por probar”.  
Si el ticket de prueba debe anularse: solo ADMIN, con motivo claro (`PRUEBA DEPLOY` + fecha), consciente de que queda en auditoría y no entra en exposición.

---

## 11. Resultados (prueba controlada)

`/admin` escribe resultados reales por fecha+hora.

- **Si hay operación en curso:** no cargar/modificar resultados de horas de negocio sin acuerdo. Preferir validar solo lectura (UI carga, listados).  
- **Si aún no hay operación / ventana de mantenimiento:** se puede cargar un resultado en una hora **ya cerrada de prueba** y revertir/cambiar solo con criterio operativo (la liquidación es derivada; el cambio afecta consultas públicas).  
- **Si no hay forma segura:** documentar “resultados: verificación diferida a primera hora operativa” y no forzar un upsert de prueba.

---

## 12. Exposición

- Solo ADMIN.  
- UI: panel “Ver apuestas” en `/admin`.  
- API: `GET /api/admin/exposicion`.  
- Solo tickets `EMITIDO`; usa `multiplicadorUsado` snapshot.  
- VENDEDOR → 403 / sin acceso UI admin.

---

## 13. Anulación

- Solo ADMIN; no DELETE físico.  
- Estado `ANULADO` + motivo + `anuladoPorId`.  
- Queda fuera de exposición y ventas activas de reportes.  
- En post-deploy: anular solo el ticket de prueba si se creó uno y la operación lo permite.

---

## 14. Reportes

- `/admin/reportes` — solo ADMIN.  
- No usa `TEST_DATABASE_URL`.  
- Verificar totales del día (emitidos/anulados) tras el ticket de prueba.

---

## 15. Auditoría

- `/admin/auditoria` — solo ADMIN.  
- Debe registrar acciones sensibles (login, tickets, resultados, usuarios, passwords) **sin** password/token/idempotencyKey.  
- Tras post-deploy: confirmar eventos del ticket/login de prueba.

---

## 16. Rollback

### Código (Vercel)

- Revertir al deployment anterior en el dashboard Vercel (“Promote” / rollback del deployment).  
- Esto **no** deshace migraciones de DB.

### Base de datos

- Las migraciones Prisma son **acumulativas**.  
- **No** recomendar rollback automático de migraciones ni `migrate reset`.  
- Si una migración falló a medias: restaurar desde **backup** o seguir el plan de contingencia de Neon; involucrar a quien opere la DB.  
- Preferir migraciones compatibles hacia adelante (expand/contract) en releases futuros.

---

## 17. Limpieza legacy

Tras comprobar login nuevo, sesiones y roles en Production:

1. Eliminar de Vercel Production (si existen):  
   - `ADMIN_PASSWORD`  
   - `ADMIN_SESSION_SECRET`  
2. Confirmar que nadie depende de cookie `admin_session`.  
3. El código legacy de auth ya está retirado; no hace falta “eliminar código” adicional.

---

## 18. Checklist final post-deploy

- [ ] HTTPS activo  
- [ ] Dominio correcto  
- [ ] `/login` OK  
- [ ] ADMIN OK  
- [ ] VENDEDOR OK  
- [ ] `/venta` OK  
- [ ] Ticket de prueba OK  
- [ ] PNG OK  
- [ ] QR → dominio prod OK  
- [ ] `/ticket/[codigo]` OK  
- [ ] Resultados (si prueba segura) OK  
- [ ] Exposición OK  
- [ ] Anulación (si aplica al ticket prueba) OK  
- [ ] Reportes OK  
- [ ] Auditoría OK  
- [ ] Logout → `/login`  
- [ ] Legacy env limpiado  
- [ ] `ADMIN_BOOTSTRAP_*` retirados o rotados según política  

---

## 19. Comandos de referencia (no contra prod en esta tarea de documentación)

| Acción | Comando |
| --- | --- |
| Build local | `npm run build` |
| Unit | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Migrar **prod** (cuando toque) | `npx prisma migrate deploy` |
| Primer ADMIN **prod** (cuando toque) | `npm run bootstrap:admin` |
| Integration (solo TEST) | `npm run test:integration` |
| Acceptance (solo TEST) | `npm run test:acceptance` |

**Nunca** en producción: `seed:manual-test`, `dev:test`, `dev:test:lan`, `migrate reset`, integration/acceptance apuntando a prod.

---

## 20. Seguridad post-deploy (recordatorio)

- Sin secrets en frontend (`NEXT_PUBLIC_*` de DB/auth no usados).  
- Sin password/token en logs de runtime.  
- APIs admin/venta protegidas por rol.  
- Ticket público limitado a `codigoPublico` (sin vendedor, sin multiplicador, sin exposición).  
- QR usa origen real del navegador (dominio HTTPS de prod).

---

## 21. Qué NO hacer en la fase de documentación / este runbook

- Deploy real  
- `migrate deploy` real a prod  
- Bootstrap contra prod  
- Seed / tests contra prod  
- Cambiar DNS, dominio o settings de Vercel desde esta tarea  

Cuando se ejecute el despliegue real, seguir este documento paso a paso.
