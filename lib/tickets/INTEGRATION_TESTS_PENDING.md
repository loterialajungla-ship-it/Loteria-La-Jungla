# Tests pendientes de integración (requieren PostgreSQL / Neon)



La capa `lib/tickets` tiene tests unitarios sin DB (`ticket-validation.test.ts`).



**Harness listo:** ver `lib/tickets/integration/README.md` y `npm run test:integration`.



Requiere `TEST_DATABASE_URL` aislada de producción.



Cobertura de integración (cuando hay DB de test):



1. `createTicket` crea Ticket + TicketLinea en una sola TX.

2. Concurrencia: creaciones paralelas → `numeroVisible` distintos.

3. Rollback: animal inexistente → no queda Ticket ni contador.

4. Idempotencia (replay / body distinto / otro usuario / carrera).

5. `multiplicadorUsado` = valor de `ConfigNegocio`.

6. Snapshot `nombreAnimalSnapshot` = `Animal.nombre` al emitir.

7. `anuladoPorId` en anulación.


