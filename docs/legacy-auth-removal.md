# Retiro de autenticación legacy — COMPLETADO

**Fecha de retirada:** 2026-10-02

Estado: **legacy eliminado del runtime**. Único sistema de producción:

`Usuario` + `UsuarioSesion` + cookie `lj_session` + `RolUsuario`

---

## Archivos eliminados

| Archivo | Motivo |
| --- | --- |
| `lib/auth/legacy.ts` | `isAdminSession`, `admin_session`, `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` |
| `lib/auth/AUTH_NOTES.md` | Notas de coexistencia obsoletas |

---

## Archivos / rutas migradas

| Pieza | Cambio |
| --- | --- |
| `middleware.ts` | Solo presencia de `lj_session` |
| `lib/auth/guards.ts` | `requireAdmin` / `requireVendorOrAdmin` sin fallback |
| `lib/auth/current-user.ts` | Sin `legacyAdmin` / `hasLegacyAdminSession` |
| `lib/auth/index.ts` | Sin reexports legacy |
| `app/admin/layout.tsx` | Solo ADMIN con sesión |
| `app/venta/layout.tsx` | Solo ADMIN \| VENDEDOR con sesión |
| `app/api/admin/logout/route.ts` | Solo limpia `lj_session` + borra `UsuarioSesion` |
| `scripts/bootstrap-admin.ts` | Usa `ADMIN_BOOTSTRAP_PASSWORD` |
| APIs `/api/admin/*` | Ya usaban `requireAdmin` (ahora sin legacy) |
| APIs `/api/venta/*` | Ya usaban `requireVendorOrAdmin` |

Públicas sin cambio: `/ticket/[codigo]`, `/api/tickets/public/[codigo]`.

---

## Variables

### Eliminadas del runtime (pueden borrarse del entorno de producción)

- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

### Bootstrap (scripts aislados; no autentican el runtime)

- `ADMIN_BOOTSTRAP_USER` (default `admin`)
- `ADMIN_BOOTSTRAP_PASSWORD` (requerida al ejecutar un script bootstrap)

**Nota (producción vs recuperación):** `npm run bootstrap:admin` es el procedimiento histórico de **dev-from-recovery** / desarrollo recuperado y **no** debe usarse para crear el administrador inicial de **producción**. El procedimiento específico de producción es `npm run bootstrap:admin:production`, siguiendo `docs/production-deployment-runbook.md` §6.1 (migración aplicada, dual opt-in y autorización humana explícita). Tras el bootstrap de prod, retirar las variables temporales de bootstrap; no confundirlas con secretos permanentes como `CRON_SECRET`.

### Auth runtime

- `AUTH_SESSION_HOURS` (opcional, default 12)

---

## Pruebas (evidencia)

**Histórico (retiro / cierre ~2026-10-02):**

- Unitarios: login/roles + tests “legacy no autentica”
- Integration: tickets / concurrencia / anulación (sobre `TEST_DATABASE_URL`)
- Acceptance: bootstrap, sesiones, permisos, tickets, liquidación, desactivación (TEST)
- Búsqueda global: sin imports ejecutables a `isAdminSession` / `admin_session` / `ADMIN_SESSION_SECRET` / `ADMIN_PASSWORD` en runtime

**Fase posterior (PROMPT 151, árbol de trabajo local):** unitarios reportados **385** aprobadas / 0 fallidas / 0 omitidas / 0 canceladas. Esa cifra **no** es PASS de un commit limpio ni verificación independiente; **no** se reejecutaron integration ni acceptance en esa fase.

---

## Pendientes (no bloquean el retiro)

- Rate limiting en `POST /api/admin/login`
- Confirmar `secure` de cookie en deploy HTTPS
- Eliminar físicamente `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` de secrets de producción tras el deploy

---

## Nota operativa

Tras desplegar este código, las cookies `admin_session` existentes **dejan de autorizar**.
Los operadores deben usar `/login` con su `Usuario` (`/admin/login` redirige a `/login`).
