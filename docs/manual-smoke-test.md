# Manual smoke test — Lotería La Jungla

**Fecha:** 2026-10-02  
**Entorno:** local (máquina de desarrollo) + PostgreSQL de prueba vía `TEST_DATABASE_URL`  
**Navegador / dispositivo UI:** no ejecutado en esta corrida (ver § Decisiones)  
**Ejecutor:** agente de validación automatizada + revisión de código de UI  
**Producción:** no se usó `DATABASE_URL` / `DIRECT_URL` para crear datos de prueba

---

## 1. Suites automáticas

| Suite | Comando | Resultado |
| --- | --- | --- |
| Prisma schema | `npx prisma validate` | PASS |
| Prisma client | `npx prisma generate` | PASS |
| Typecheck | `npx tsc --noEmit` | PASS |
| Lint | `npm run lint` | PASS |
| Unit | `npm test` | PASS — 199 tests |
| Integration | `npm run test:integration` | PASS — tickets + passwords + reportes + auditoría (sobre `TEST_DATABASE_URL`) |
| Acceptance | `npm run test:acceptance` | PASS — 26 tests (sobre `TEST_DATABASE_URL`) |

---

## 2. Decisiones de alcance

1. **No bootstrap / UI contra `DATABASE_URL`.**  
   El `.env` local carga `DATABASE_URL` (posible Neon de trabajo). Para no contaminar datos reales no se ejecutó:
   - `npm run bootstrap:admin` sobre esa URL;
   - creación de tickets/vendedores vía UI o API apuntando a producción;
   - pruebas destructivas en la DB de aplicación.

2. **Validación funcional de negocio:** cubierta por `test:integration` + `test:acceptance` contra `TEST_DATABASE_URL` aislada (guard `safe-test-db`).

3. **PNG visual / QR escaneado / responsive / a11y:**  
   - **PNG + QR en dispositivo (PC + móvil LAN):** verificados posteriormente (2026-10-02) con `dev:test:lan` — PNG completo con QR legible tras fix de captura móvil.  
   - **Responsive:** `/venta` y `/ticket/[codigo]` usados en móvil durante pruebas LAN (OK funcional; no audit formal de breakpoints).  
   - **A11y completa:** parcial (labels/alerts); audit formal **MANUAL PENDING**.

4. **Sin correcciones de código.** No se detectó defecto que exigiera cambiar reglas, Prisma o migraciones.

---

## 3. Casos vs resultado

Leyenda:

- **PASS (auto):** demostrado por unit / integration / acceptance.
- **PASS (código):** revisado en implementación + tests unitarios de UI helpers.
- **MANUAL PENDING:** requiere navegador/dispositivo; no ejecutado aquí por seguridad de entorno.

| # | Caso | Resultado | Evidencia |
| --- | --- | --- | --- |
| 2 | Login / rutas ADMIN | PASS (auto) + MANUAL PENDING UI | Acceptance: login ADMIN, `authorizeAdminUi` / `authorizeVentaUi` / `authorizePerfilUi`. Layout `/admin/*` exige ADMIN. |
| 3 | Crear vendedor | PASS (auto) | Integration auditoría CREAR_VENDEDOR; acceptance creación vendor. Contraseña solo como hash (unit). |
| 4 | Login VENDEDOR + bloqueo admin | PASS (auto) | Acceptance permisos: VENDEDOR no `canAccessAdminApi`; UI admin redirige a `/venta`. `/perfil` permitido. |
| 5 | Ticket simple | PASS (auto) | Acceptance/integration createTicket: total, vendedorId, líneas. |
| 6 | Ticket multihora | PASS (auto) + unit | Validation: misma hora+animal duplicado rechazado; distinta hora mismo animal OK. |
| 7 | Idempotencia | PASS (auto) | Acceptance + integration: replay, conflicto body, concurrencia same-key. |
| 8 | Historial vendedor | PASS (auto) | Acceptance: A ve solo suyos; B ajeno 404; detalle líneas. |
| 9 | PNG contenido | PASS (código + manual dispositivo) | Preview/PNG: marca, número, fecha, horas, animal, importe, total, QR. Sin multiplicador/premio/exposición. Descarga PNG verificada en PC y móvil (LAN). |
| 10 | QR → codigoPublico | PASS (auto + manual) | URL con `codigoPublico`; escaneo/consulta desde móvil en pruebas LAN OK. |
| 11 | Consulta pública | PASS (auto) | Acceptance: público por codigoPublico; sin passwordHash/token. Contrato: sin vendedor/exposición/multiplicador en vista pública. |
| 12–13 | Resultado + cambio A→B | PASS (auto) | Acceptance liquidación + auditoría MODIFICAR_RESULTADO 03→05. |
| 14 | Multiplicador histórico | PASS (auto) | Acceptance: ticket conserva `multiplicadorUsado` tras cambiar ConfigNegocio en test DB. |
| 15 | Exposición vs anulado | PASS (auto) | Acceptance: exposición ignora anulados. |
| 16 | Anulación ADMIN | PASS (auto) | Acceptance: anuladoPorId; vendedor sigue consultando; audit ANULAR. |
| 17 | VENDEDOR no anula | PASS (auto) | `canAccessAdminApi(VENDEDOR)=false`; API anular usa `requireAdmin`. |
| 18 | Desactivar / reactivar | PASS (auto) | Acceptance: desactivar invalida sesión; reactivar exige login nuevo. |
| 19 | Password change / reset | PASS (auto) | Acceptance: change + reset; sesiones 0; antigua falla. |
| 20 | Reportes | PASS (auto) | Acceptance + integration reportes: consistencia Σ vendedor / Σ horas. |
| 21 | Auditoría | PASS (auto) | Integration: CREAR/ANULAR ticket, vendedor, passwords, resultado; acceptance MODIFICAR; sin secretos. LOGIN/LOGOUT best-effort (código + README audit). |
| 22 | Históricos vendedorId null | PASS (auto) | Acceptance historial ADMIN ve null; vendedor no ve ajenos. Reportes “Sin vendedor”. |
| 23 | Horas cerradas | PASS (auto) | Acceptance: pasadas/actual/con resultado rechazan; futuras OK según harness. |
| 24 | Multahora vs duplicado | PASS (auto) | Unit `DuplicateTicketLineError`; multihora en createTicket. |
| 25 | Decimales | PASS (auto) | Integration: 2.10+3.25+0.01=5.36 Decimal. |
| 26 | Doble click | PASS (código) | `TicketPOS`: guard `if (creando)`; fieldset disabled; idempotencyKey estable en reintento. |
| 27 | Responsive | MANUAL PENDING | Layout mobile-first existente; no se midió viewport real. |
| 28 | Accesibilidad básica | PASS (código) parcial | Labels en formularios admin/venta/perfil; botones disabled en carga; mensajes role=alert en cambio password. Audit completo a11y = MANUAL PENDING. |
| 29 | Navegación | PASS (código) | Enlaces admin (tickets, usuarios, reportes, auditoría, venta, perfil); venta/tickets; público `/ticket/[codigo]`. |
| 30 | Contrato | PASS | Sin contradicción nueva; alineado con `docs/ticket-business-contract.md`. |

---

## 4. Problemas encontrados

Ninguno bloqueante en suites automáticas.

**Pendiente operativo (no bug):** audit a11y formal y bootstrap ADMIN en UI sobre DB de test dedicada — usar `docs/manual-test-environment.md` (`seed:manual-test`, `dev:test` / `dev:test:lan`). Login oficial: `/login`.

---

## 5. Correcciones realizadas

Ninguna. Solo documentación de esta validación.

---

## 6. Checklist rápido para smoke UI humano (entorno seguro)

Cuando exista un entorno no productivo:

1. `npm run bootstrap:admin` (solo DB de test).
2. Login ADMIN → recorrer `/admin`, `/admin/tickets`, `/admin/usuarios`, `/admin/reportes`, `/admin/auditoria`, `/venta`, `/perfil`.
3. Crear vendedor → logout → login vendedor → `/venta` OK; `/admin*` bloqueado.
4. Crear ticket simple + multihora → PNG descargar → verificar visualmente lista §9.
5. Escanear QR → `/ticket/[codigo]`.
6. Admin: exposición, resultado, cambio de resultado, anulación, reportes, auditoría.

No registrar contraseñas, tokens ni URLs con credenciales en este documento.
