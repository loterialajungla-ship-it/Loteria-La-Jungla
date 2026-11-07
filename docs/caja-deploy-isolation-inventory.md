# Inventario de aislamiento para despliegue Caja (C7.2)

**Propósito:** planificar un deploy limpio **sin** staging/commit en esta fase.  
**HEAD de referencia al auditar:** `8127901` + working tree sucio.

---

## A. Incluir en el paquete Caja (+ C7.2 anulaciones)

### Migraciones
- `prisma/migrations/20261106223000_add_caja_comisiones/`
- `prisma/migrations/20261106230000_add_caja_obligacion/`
- `prisma/migrations/20261107010000_add_caja_declaraciones_confirmaciones/`
- `prisma/migrations/20261107020000_add_caja_aplicacion/`
- `prisma/migrations/20261107021000_caja_aplicacion_cupos_for_update/`
- Cambios en `prisma/schema.prisma` (modelos Caja + enums auditoría relacionados)

### Dominio / API / UI Caja
- `lib/caja/**`
- `app/api/admin/caja/**`
- `app/api/venta/caja/**`
- `app/admin/caja/**`
- `app/venta/caja/**`
- `components/caja/**`
- Enganche ticket: `lib/tickets/create-ticket.ts` (+ tests Caja)
- Comisión al alta: `lib/users/admin-users.ts` (bloque Caja)
- Nav / accesos: `components/nav/nav-config.ts`, `app/admin/page.tsx` (link Caja)
- Parse/atribución ticket si es dependencia C3: `lib/tickets/parse-create-ticket-body.ts`, `types.ts`, `map-ticket-http-error.ts`

### C7.2 — prohibición de anulaciones (obligatorio junto a Caja)
- `lib/tickets/anular-ticket.ts`
- `lib/tickets/errors.ts` (`TicketAnulacionProhibidaError`)
- `lib/tickets/map-ticket-http-error.ts`
- `app/api/admin/tickets/[id]/anular/route.ts`
- `app/admin/tickets/[id]/page.tsx`
- `components/tickets/AnularTicketPanel.tsx`
- Tests asociados (`anular-ticket-*.test.ts`, ajustes integración/acceptance)
- `lib/tickets/integration/seed-historical-anulado.ts` (solo tests)
- Script/guards activación: `scripts/activate-caja-production.ts`, `lib/dev/activate-caja-production.ts`, guard en `lib/db/neon-endpoint-guard.ts`
- Docs: `docs/caja-activation-runbook.md`, este inventario
- `package.json` script `activate:caja:production`

---

## B. Excluir del despliegue Caja (WIP ajeno — no descartar localmente)

Revisar y **no** mezclar salvo dependencia real documentada:

- Cambios de resultados automáticos / exposición mínima no necesarios para Caja.
- Cambios de auditoría genérica no ligados a enums Caja (`lib/audit/*` solo si el deploy Caja necesita los nuevos valores de enum; si el schema Caja ya los añade en migraciones, evitar diffs de formato/listados ajenos).
- `lib/tickets/integration/owned-ticket-domain.ts` — parcial Caja (cleanup obligaciones); incluir solo el delta Caja si el resto es WIP de harness.
- `scripts/run-integration-tests.ts` — solo si lista archivos Caja; evitar otros cambios de runner no relacionados.
- Cualquier experimento local no listado en A.

**Acción futura (C7.3):** cherry-pick / commit selectivo / PR enfocada usando este inventario. **No** `git reset` ni borrado de WIP ajeno.

---

## C. Dependencias entre cambios

| Dependencia | Motivo |
|-------------|--------|
| `create-ticket` ↔ `lib/caja/obligacion` | Obligación en misma TX |
| `admin-users` ↔ `ensureComisionInicialSiAusente` | 20 % si Caja activa |
| Schema + 5 migraciones | Runtime Prisma requiere tablas |
| Prohibición anular ↔ Caja | Evita deuda fantasma post-anulación |
| Guards Neon ↔ script activación | Solo PRODUCTION |

---

## D. Orden sugerido de commits futuros (no ejecutado aquí)

1. Schema + migraciones Caja.  
2. Dominio Caja C1–C5.1 + enganche tickets/usuarios.  
3. APIs + UI C6.  
4. C7.2 anulación prohibida + script/runbook activación.
