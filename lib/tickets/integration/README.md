# Tests de integración (PostgreSQL real)

## Separación

| Comando | Qué ejecuta | Requiere DB |
| --- | --- | --- |
| `npm test` | Unitarios (`*.test.ts`) | No |
| `npm run test:integration` | Integración (`*.integration.test.ts`) | Sí (`TEST_DATABASE_URL`) |

## Requisitos

1. Una PostgreSQL **dedicada a tests** (local, Neon branch, CI service).
2. Variable de entorno:

```env
TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/llj_test?sslmode=require"
```

**Nunca** uses la misma URL que `DATABASE_URL` o `DIRECT_URL` de producción.

## Seguridad

El runner (`scripts/run-integration-tests.ts`) aborta si:

- falta `TEST_DATABASE_URL`;
- `TEST_DATABASE_URL === DATABASE_URL`;
- `TEST_DATABASE_URL === DIRECT_URL`.

Mensaje típico:

> Se rechazó la ejecución: la base de datos de test no parece aislada de producción.

## Flujo del runner

1. Valida aislamiento.
2. `prisma migrate deploy` **solo** sobre `TEST_DATABASE_URL` (vía env del proceso hijo).
3. Ejecuta la suite de integración.

No usa `migrate reset` contra producción.

## Cobertura actual

- creación básica + snapshot + multiplicador;
- Decimal (`5.36`);
- contador secuencial;
- concurrencia de numeración (20);
- idempotencia replay / body distinto / otro usuario;
- concurrencia de idempotencia (10 → 1 ticket);
- rollback animal inexistente;
- `anuladoPorId`;
- ticket histórico con `idempotencyKey` null.

## Cómo crear una DB de test (ejemplos)

### Neon

Crear un branch/proyecto aparte y copiar solo su connection string a `TEST_DATABASE_URL`.

### PostgreSQL local

```bash
createdb llj_test
# TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/llj_test
```
