# Estado final V1 — Lotería La Jungla

**Fecha de cierre técnico:** 2026-10-02  
**Alcance:** auditoría + login oficial `/login` + documentación.  
**Sin V2.** Sin cambios de reglas comerciales (30×, ticket solo jugado, anulación ADMIN, etc.).

---

## 1. Funciones incluidas en V1

| Área | Capacidad |
| --- | --- |
| Auth | `/login` único; sesiones `UsuarioSesion` + cookie `lj_session`; logout → `/login` |
| Roles | ADMIN / VENDEDOR |
| Usuarios | crear vendedor, activar/desactivar, listado admin |
| Contraseñas | bcrypt; change-password; reset ADMIN→VENDEDOR |
| POS `/venta` | multihora, multianimal, importes, total, crear ticket |
| Tickets | emisión, contador atómico, idempotencia, inmutabilidad |
| PNG / QR | ticket visual + descarga PNG con QR (`codigoPublico`) |
| Consulta pública | `/ticket/[codigo]` liquidación derivada |
| Resultados | cargar/modificar en `/admin` |
| Exposición | panel + API, solo EMITIDO, snapshot multiplicador |
| Anulación | solo ADMIN; conserva filas; auditoría |
| Historial | `/venta/tickets` (propios) · `/admin/tickets` |
| Reportes | `/admin/reportes` diario |
| Auditoría | `/admin/auditoria` + eventos sensibles |
| Perfil | `/perfil` |
| Dev test | `dev:test`, `dev:test:lan`, `seed:manual-test` |

Compatibilidad: `/admin/login` → **308** → `/login`.

---

## 2. Funciones verificadas

| Módulo | Estado |
| --- | --- |
| AUTH | funciona |
| USUARIOS | funciona |
| POS | funciona |
| TICKETS | funciona |
| IDEMPOTENCIA | funciona |
| QR | funciona |
| PNG | funciona (fix móvil: reinyección QR en canvas export) |
| CONSULTA PÚBLICA | funciona |
| RESULTADOS | funciona |
| EXPOSICIÓN | funciona |
| ANULACIÓN | funciona |
| HISTORIAL | funciona |
| REPORTES | funciona |
| AUDITORÍA | funciona |

Suites:

| Origen | Unit | Integration | Acceptance | tsc / lint |
| --- | --- | --- | --- | --- |
| Cierre histórico 2026-10-02 | **219 PASS** | PASS (TEST) | **26 PASS** (TEST) | PASS |
| Reportado PROMPT 151 (árbol de trabajo local; **no** commit limpio ni CI independiente) | **385** aprobadas, 0 fallidas, 0 omitidas, 0 canceladas | **No ejecutado** en esa fase | **No ejecutado** en esa fase | **No revalidado** en esa fase |

Smoke (histórico LAN): PNG+QR en PC y móvil; a11y formal **pendiente**. Despliegue productivo, automatización de resultados (scheduler externo pendiente; Hobby sin cron cada 5 min) y DB de producción: **no verificados**.

---

## 3. Funciones pendientes

### BLOQUEANTE PARA PRODUCCIÓN

Ningún defecto funcional detectado en código vs reglas V1 **como bloqueador de diseño**, **siempre que** se complete (aún **pendiente** de ejecución autorizada; no afirmar que ya ocurrió):

- deploy con **HTTPS**;
- `DATABASE_URL` / `DIRECT_URL` de producción (nunca `TEST_DATABASE_URL` como runtime prod);
- `CRON_SECRET` en Production si se invocará `/api/cron/resultados-automaticos` (sin él el endpoint es **fail-closed**; ver `docs/production-preflight.md` §20 — **no** implica automatización activa; Hobby: `vercel.json` con `"crons": []`);
- primer ADMIN de producción provisionado con `npm run bootstrap:admin:production` (o ADMIN ya existente); **no** usar `npm run bootstrap:admin` contra producción (ese comando es solo **dev-from-recovery**);
- secretos legacy `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` no usados (runtime no los lee).

**No** ejecutar migraciones ni bootstrap desde esta documentación; requieren autorización humana explícita.

### NO BLOQUEANTE

- Rate limit login / consulta pública
- CSRF más estricto que `SameSite=lax` + httpOnly
- Audit a11y formal
- Comentario Prisma TicketCounter desactualizado (“FOR UPDATE” vs ON CONFLICT)
- Página dedicada `/admin/exposicion` (capacidad ya en `/admin`)
- Web Share archivos solo en contextos seguros (HTTP LAN puede caer a descarga)

### V2 (producto)

- Tope máximo de apuesta
- Ventana temporal de anulación
- Recuperación de contraseña por email
- UI para editar `MULTIPLICADOR_PREMIO`
- Cierres de caja / comisiones / pagos
- Impresión térmica nativa
- Historial de cambios de resultado (más allá de auditoría)
- WhatsApp API / Excel / PDF / gráficos

---

## 4. Reglas de negocio congeladas

1. Ticket visual/PNG: solo jugado (marca, número, fecha, horas, animal+nombre, importes, total, QR). Sin 30×, premio, exposición, riesgo, ganancia.
2. Ticket emitido inmutable; única mutación ADMIN = anulación.
3. Anulación: no DELETE; `ANULADO` + `anuladoAt` / `motivoAnulacion` / `anuladoPorId`; fuera de exposición y ventas activas.
4. `ConfigNegocio` = vigente; `Ticket.multiplicadorUsado` = snapshot; premios/exposición usan snapshot.
5. Liquidación derivada del `Resultado` actual (cambio 03→05 recalcula sin editar líneas).
6. Horas cerradas: `hora <= horaActual` Caracas o resultado existente; backend valida igual.
7. Idempotencia: misma key+usuario+body → replay; conflictos 409; concurrencia → un ticket.
8. Numeración: `TicketCounter` atómico (no `count+1`).
9. VENDEDOR: venta + propios tickets; no admin/exposición/resultados/anulación/ajenos.
10. Desactivar usuario invalida sesiones; reactivar exige login nuevo.
11. QR / consulta pública por `codigoPublico`, no `numeroVisible`.
12. Multiplicador comercial vigente documentado = 30× (config).

---

## 5. Riesgos conocidos

| Riesgo | Nivel | Nota |
| --- | --- | --- |
| Sin rate limit login | No bloqueante V1 | Abuso de fuerza bruta |
| Sin rate limit consulta pública | No bloqueante | Enumeración de códigos |
| CSRF sin token dedicado | No bloqueante | Mitigado SameSite=lax |
| `codigoPublico` = acceso lectura | Diseño | Contrato §10 |
| Cookie `secure` solo en prod | Operacional | Requiere HTTPS en producción |
| Mezclar TEST y prod DB | Operacional | Guards en seed/`dev:test` |

---

## 6. Problemas no bloqueantes

- Docs architecture históricos vs código (auth, contador, reportes): gana **código + contrato**.
- Contrato §23 actualizado en este cierre (reportes/password parcial).
- Share en HTTP LAN puede descargar en lugar de hoja nativa.

---

## 7. Checklist para producción

Orden operativo alineado con `docs/production-deployment-runbook.md` §6.1 (ningún ítem implica que ya se haya ejecutado):

- [ ] HTTPS obligatorio
- [ ] `DATABASE_URL` + `DIRECT_URL` producción (pooled + direct Neon si aplica)
- [ ] **No** requerir `TEST_DATABASE_URL` en runtime prod
- [ ] `CRON_SECRET` en Production si habrá invocación autenticada del endpoint `/api/cron/resultados-automaticos` (sin secreto = fail-closed). Hobby: sin cron Vercel cada 5 min; scheduler externo **pendiente**; hasta entonces resultados por ADMIN — **no** afirmar automatización activa
- [ ] Backup verificable **antes** de migrar (pendiente de ejecución autorizada)
- [ ] Regeneración/build del código necesario (`prisma generate` vía build/postinstall)
- [ ] Despliegue del código cuando corresponda
- [ ] Migraciones Prisma aplicadas en producción (incl. enum `CREAR_ADMIN` si pendiente)
- [ ] Verificar el enum / schema en el destino tras migrate
- [ ] Primer ADMIN: `npm run bootstrap:admin:production` con dual opt-in y autorización humana explícita (**o** ADMIN ya existente). **No** `npm run bootstrap:admin` en prod (solo **dev-from-recovery**)
- [ ] Comprobar acceso `/login` → ADMIN `/admin`
- [ ] Retirar variables temporales: `BOOTSTRAP_TARGET`, `CONFIRM_PRODUCTION_BOOTSTRAP`, `ADMIN_BOOTSTRAP_*`
- [ ] Revisar que no queden secretos en logs/UI
- [ ] Cookie `lj_session` httpOnly + SameSite=lax + secure
- [ ] Smoke login ADMIN/VENDEDOR; ticket, PNG+QR, consulta pública, resultado, exposición, anulación, reportes
- [ ] Política de retención DB según operación

Variables **obligatorias prod:** `DATABASE_URL`, `DIRECT_URL` (si el cliente Prisma las usa). `CRON_SECRET` cuando se use el endpoint de resultados automáticos con scheduler externo o probes autenticados (aún no configurado como automatización activa).
Variables **solo bootstrap prod (temporales):** `BOOTSTRAP_TARGET=production`, `CONFIRM_PRODUCTION_BOOTSTRAP`, `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD`.  
Variables **solo test/dev:** `TEST_DATABASE_URL`, `MANUAL_TEST_*`.  
Comando **dev-from-recovery** (no prod): `npm run bootstrap:admin`.

---

## 8. Funciones previstas para V2

Ver §3 V2. No implementar en este cierre.

---

## 9. Cambios de este cierre (documentados)

1. Login oficial UI: `/login` (único formulario).
2. `/admin/login` → redirección **308** (middleware + página compat).
3. Redirects post-auth/logout/layouts/perfil → `/login`.
4. Usuario con sesión en `/login` → `/admin` o `/venta` según rol.
5. Alineación docs (contrato, smoke, manual-test, legacy-auth, bootstrap).
6. Sin cambios de reglas comerciales ni Prisma schema en este cierre.

---

## 10. Precedencia documentación

Ante contradicción: **código implementado + `ticket-business-contract.md` (actualizado)** > `tickets-architecture.md` histórico.
