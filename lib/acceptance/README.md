# Acceptance / smoke tests

## Comando

```bash
npm run test:acceptance
```

Requiere `TEST_DATABASE_URL` aislada (mismo guard que integración).

| Situación | Resultado |
| --- | --- |
| Sin `TEST_DATABASE_URL` | `SKIPPED` (exit 0) |
| URL = `DATABASE_URL` / `DIRECT_URL` | Abort (exit 1) |
| URL de test OK | Suite real |

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
