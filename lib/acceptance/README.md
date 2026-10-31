# Acceptance / smoke tests

## Comando

```bash
npm run test:acceptance
```

Requiere `TEST_DATABASE_URL` aislada (mismo guard que integración).

| Situación | Resultado |
| --- | --- |
| Sin `TEST_DATABASE_URL` (default / release / CI) | **FAIL** (exit 1) — la suite no se ejecutó |
| Sin `TEST_DATABASE_URL` + `ALLOW_ACCEPTANCE_SKIP=1` | `SKIPPED` (exit 0) + banner `ACCEPTANCE_RESULT=SKIPPED (not a PASS)` |
| URL = `DATABASE_URL` / `DIRECT_URL` / no allowlisted | Abort (exit 1) |
| URL de test OK | Suite real → PASS solo si todos los casos pasan |

**Release:** no interpretar exit 0 con `ACCEPTANCE_RESULT=SKIPPED` como aprobación.
Sin `ALLOW_ACCEPTANCE_SKIP`, la ausencia de URL falla de forma cerrada.

Separado de:

- `npm test` — unitarios
- `npm run test:integration` — tickets/Prisma críticos

## Enfoque

Servicios reales (`lib/auth`, `lib/tickets`, `lib/users`) + PostgreSQL de test.
No Playwright/Cypress. Las reglas UI/API se verifican con espejos de layouts/guards
(`authorize-rules.ts`) alimentados por sesiones reales (`resolveSessionByToken`).

## Cobertura

Bootstrap ADMIN, login, permisos, tickets/propiedad, anulación, desactivación,
liquidación, exposición, multiplicador histórico, idempotencia, concurrencia,
horas cerradas, QR (`codigoPublico`), logout/expiración, cookies, secretos.
