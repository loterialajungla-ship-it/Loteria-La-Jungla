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

### Bootstrap (script aislado; no autentican)

- `ADMIN_BOOTSTRAP_USER` (default `admin`)
- `ADMIN_BOOTSTRAP_PASSWORD` (requerida para `npm run bootstrap:admin`)

### Auth runtime

- `AUTH_SESSION_HOURS` (opcional, default 12)

---

## Pruebas realizadas

- Unitarios: login/roles + tests “legacy no autentica”
- Integration: tickets / concurrencia / anulación
- Acceptance: bootstrap, sesiones, permisos, tickets, liquidación, desactivación
- Búsqueda global: sin imports ejecutables a `isAdminSession` / `admin_session` / `ADMIN_SESSION_SECRET` / `ADMIN_PASSWORD` en runtime

---

## Pendientes (no bloquean el retiro)

- Rate limiting en `POST /api/admin/login`
- Confirmar `secure` de cookie en deploy HTTPS
- Eliminar físicamente `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` de secrets de producción tras el deploy

---

## Nota operativa

Tras desplegar este código, las cookies `admin_session` existentes **dejan de autorizar**.
Los operadores deben usar `/login` con su `Usuario` (`/admin/login` redirige a `/login`).
