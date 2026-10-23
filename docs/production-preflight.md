# Production preflight — Lotería La Jungla V1

**Fecha:** 2026-10-02  
**Alcance:** verificación pre-producción (sin tocar datos de producción, sin V2).  
**App:** `sorteo-lotto-activo`

---

## 1. Estado del build

| Paso | Resultado |
| --- | --- |
| `prisma generate` | PASS |
| `next build` | PASS |
| Compilación / tipos / lint en build | PASS |
| Rutas generadas | `/login`, `/admin/*`, `/venta/*`, `/ticket/[codigo]`, APIs admin/venta/público |

**Nota local:** el primer intento de build falló con `EPERM` al renombrar el query-engine de Prisma (archivo bloqueado por un `node`/`next` en ejecución). Tras liberar el puerto/proceso, `npm run build` completó OK. No es un defecto de código.

`postinstall` = `prisma generate` (útil en Vercel).  
`build` = `prisma generate && next build`.  
**No** se ejecutan en build: `seed:manual-test`, `test:integration`, `test:acceptance`, `dev:test`, `dev:test:lan`.

---

## 2. Tests

| Suite | Comando | Resultado |
| --- | --- | --- |
| Unit | `npm test` | **Histórico (cierre 2026-10-02):** PASS — 219. **Reportado PROMPT 151 (árbol de trabajo local, no commit limpio):** 385 aprobadas, 0 fallidas, 0 omitidas, 0 canceladas. No es verificación independiente ni PASS de un clone limpio. |
| Typecheck | `npx tsc --noEmit` | Histórico PASS (2026-10-02); **no revalidado** en la fase post-385 |
| Lint | `npm run lint` | Histórico PASS (2026-10-02); **no revalidado** en la fase post-385 |
| Integration | `npm run test:integration` | Histórico PASS sobre `TEST_DATABASE_URL` (2026-10-02). **No ejecutado / no afirmado PASS** en la fase post-385 |
| Acceptance | `npm run test:acceptance` | Histórico PASS — 26 sobre `TEST_DATABASE_URL` (2026-10-02). **No ejecutado / no afirmado PASS** en la fase post-385 |

Integración/aceptación **deben** usar solo DB de prueba aislada (`TEST_DATABASE_URL` + guards); **nunca** la DB de producción. No se recomienda ejecutarlas en esta fase documental.

---

## 3. Variables

### Runtime de producción (obligatorias)

| Variable | Uso | Notas |
| --- | --- | --- |
| `DATABASE_URL` | Prisma (pooled) | Obligatoria |
| `DIRECT_URL` | Prisma `directUrl` (migraciones / Neon) | Obligatoria según `schema.prisma` |

### Runtime de producción (opcionales / cron)

| Variable | Uso | Default / notas |
| --- | --- | --- |
| `AUTH_SESSION_HOURS` | Duración cookie `lj_session` | `12` (máx. 168) |
| `NODE_ENV` | `production` → cookie `secure` | Lo fija el host |
| `CRON_SECRET` | Auth del cron `POST/GET` `/api/cron/resultados-automaticos` (`Authorization: Bearer …` o `x-cron-secret`) | **Obligatoria para que el cron acepte requests.** Si falta o está vacía, `authorizeCronRequest` responde **fail-closed** (`false`) — el endpoint no autoriza. Esto describe el código local; **no** implica que el cron esté activo ni verificado en producción. |

### Solo operaciones / bootstrap (no auth runtime)

| Variable | Uso |
| --- | --- |
| `ADMIN_BOOTSTRAP_USER` | Opcional; default `admin` |
| `ADMIN_BOOTSTRAP_PASSWORD` | Obligatoria al ejecutar un script bootstrap |
| `BOOTSTRAP_TARGET` | `dev-from-recovery` **o** `production` según el comando |
| `CONFIRM_PRODUCTION_BOOTSTRAP` | Solo prod: frase `I_UNDERSTAND_THIS_WRITES_PRODUCTION` |

**Comandos (separados; no intercambiables):**

| Comando | Destino | Condiciones |
| --- | --- | --- |
| `npm run bootstrap:admin` | Solo **dev-from-recovery** | `BOOTSTRAP_TARGET=dev-from-recovery` + guard del endpoint de recuperación |
| `npm run bootstrap:admin:production` | Solo **producción** | Dual opt-in (`BOOTSTRAP_TARGET=production` + `CONFIRM_PRODUCTION_BOOTSTRAP=I_UNDERSTAND_THIS_WRITES_PRODUCTION`) + allowlist PRODUCTION; tras backup + `migrate deploy` cuando corresponda |

Retirar variables temporales tras un bootstrap exitoso. **Este preflight no recomienda ejecutar migraciones ni bootstrap ahora**; requieren autorización humana explícita y no se dan por hechos.

### Solo test / desarrollo local

| Variable | Uso |
| --- | --- |
| `TEST_DATABASE_URL` | Integración, acceptance, `dev:test`, `dev:test:lan`, `seed:manual-test` |
| `MANUAL_TEST_*` | Seed manual (`ADMIN`/`VENDOR` user+password, opcional base URL) |

**`TEST_DATABASE_URL` NO es necesaria para producción.**  
Ningún código bajo `app/` la referencia. Solo aparece en `lib/dev`, `lib/tickets/integration`, `lib/acceptance`, `scripts/*` de test.

**No documentar valores reales aquí.**

### Legacy (no requeridas)

| Variable / cookie | Estado |
| --- | --- |
| `ADMIN_PASSWORD` | No leída por runtime; solo mención histórica / mapeo en runner de acceptance |
| `ADMIN_SESSION_SECRET` | No autoriza |
| `admin_session` | No es mecanismo válido |

---

## 4. Prisma

### Migraciones (orden)

1. `20260925010837_init`
2. `20260930232404_add_tickets_models`
3. `20261001002140_add_users_and_sessions`
4. `20261002012244_add_ticket_idempotency`
5. `20261002160000_add_auditoria`
6. `20261017220000_resultado_origen_auditoria_sistema`
7. `20261023010000_accion_auditoria_crear_admin`

En TEST: los runners ejecutan `prisma migrate deploy` sobre `TEST_DATABASE_URL` si hace falta.

### Despliegue recomendado (producción)

1. **Backup verificable** de PostgreSQL/Neon.  
2. En entorno con `DATABASE_URL` + `DIRECT_URL` de **producción**:  
   `npx prisma migrate deploy`  
3. Deploy de la app (`npm run build` / Vercel).  
4. Si no hay ADMIN en **producción**: dual opt-in + `npm run bootstrap:admin:production` (una vez; **no** `bootstrap:admin`).  

**No** usar `prisma migrate reset` en producción.  
**No** ejecutar `seed:manual-test` ni `ensure:test-admin` contra producción.

---

## 5. Auth

- Login UI: `/login` (único formulario).  
- Compat: `/admin/login` → 308 → `/login`.  
- Mecanismo: `Usuario` + `UsuarioSesion` + cookie `lj_session`.  
- Sin fallback legacy.  
- Bootstrap: script aislado con `ADMIN_BOOTSTRAP_*` (no imprime password/hash; no duplica ADMIN).

---

## 6. Roles

| Rol | Acceso |
| --- | --- |
| ADMIN | `/admin/*`, APIs admin, `/venta`, anulación, resultados, exposición, reportes, auditoría, usuarios |
| VENDEDOR | `/venta`, tickets propios, change-password |
| Público | `/`, `/ticket/[codigo]`, `GET /api/tickets/public/[codigo]` |

---

## 7. Seguridad

### Cookie `lj_session`

| Atributo | Valor |
| --- | --- |
| httpOnly | `true` |
| sameSite | `lax` |
| path | `/` |
| maxAge | `AUTH_SESSION_HOURS` → segundos |
| secure | `true` cuando `NODE_ENV === "production"` |

### HTTPS

Producción **debe** servirse bajo HTTPS (Vercel / proxy). La cookie `secure` lo exige para sesiones en navegadores modernos.

### Frontend secrets

- Sin `NEXT_PUBLIC_*` en el repo.  
- `DATABASE_URL` / `DIRECT_URL` / hashes / tokens no se envían a Client Components ni JSON públicos.

### Logs revisados

- Auth password change/reset: solo `userId` + timestamp.  
- Audit best-effort: `accion` + `usuarioId` + mensaje genérico.  
- Scripts de test/bootstrap: no imprimen passwords.  
- No se hallaron logs de `password` / `token` / URLs de DB en runtime de app.

### Errores API

Mapeo a 401/403/404/409/400/500 amigables; sin stack/SQL en respuestas de negocio.

### Seguridad no bloqueante → V2 / mejora operativa

| Ítem | Clasificación |
| --- | --- |
| Rate limit login | SEGURIDAD V2 |
| Rate limit consulta pública | SEGURIDAD V2 |
| CSRF más estricto | MEJORA OPERATIVA / V2 |
| Recuperación password por email | V2 |
| 2FA | V2 |

---

## 8. QR

- URL: `{window.location.origin}/ticket/{codigoPublico}`.  
- Sin hardcode de localhost / 127.0.0.1 / 192.168.* / dominio TEST.  
- Independiente de `numeroVisible`.

---

## 9. PNG

- Generación en navegador (`html-to-image` + reinyección QR).  
- No depende de `TEST_DATABASE_URL`, `dev:test` ni `dev:test:lan`.  
- Contenido: solo lo jugado + QR (contrato V1).

---

## 10. APIs (resumen)

| Ámbito | Endpoints |
| --- | --- |
| Público | login POST, consulta ticket, resultados públicos (home) |
| Venta | horas, tickets CRUD lectura/creación (sesión) |
| Admin | resultados, tickets, anular, exposición, usuarios, reportes, auditoría |

Consulta pública **no** expone: `vendedorId`, `anuladoPorId`, `passwordHash`, `tokenHash`, `idempotencyKey`, multiplicador, exposición.  
Sí puede mostrar `premioTotal` / estado derivados según contrato.

---

## 11. Datos TEST

| Referencia | Clasificación |
| --- | --- |
| `manual_admin` / `manual_vendedor` | Solo defaults de `seed-manual-test` |
| `MANUAL_TEST_*` | Env del seed manual |
| `seed-manual-test` | Script npm; **no** en build/deploy |
| `TEST_DATABASE_URL` | Solo test/dev |
| `dev:test` / `dev:test:lan` | Solo desarrollo; no requeridos por build/runtime prod |

**No** se ejecutan contra producción en este preflight.

---

## 12. Logs

Ver §7. Scripts CLI pueden usar `console.log` informativo sin secretos. Runtime de app: logs de auth/auditoría sin secretos.

---

## 13. Checklist de despliegue

- [ ] `DATABASE_URL` correcto (prod)
- [ ] `DIRECT_URL` correcto si aplica
- [ ] `AUTH_SESSION_HOURS` (opcional)
- [ ] `ADMIN_BOOTSTRAP_*` listos si hace falta crear el primer ADMIN
- [ ] `TEST_DATABASE_URL` **no** configurada como dependencia del runtime prod
- [ ] Legacy `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` eliminables del env prod
- [ ] HTTPS activo
- [ ] Dominio configurado
- [ ] Backup verificable antes de migrar
- [ ] `npx prisma migrate deploy` en prod
- [ ] Deploy app (`build` / Vercel)
- [ ] ADMIN creado (`bootstrap:admin:production` o existente; no `bootstrap:admin` ni seeds TEST)
- [ ] `CRON_SECRET` configurado en Production (cron resultados)
- [ ] Variables temporales de bootstrap retiradas tras el éxito
- [ ] VENDEDOR creado desde admin
- [ ] Login `/login` probado
- [ ] `/venta` probado
- [ ] Ticket emitido
- [ ] PNG + QR
- [ ] Consulta pública
- [ ] Resultados
- [ ] Exposición
- [ ] Anulación
- [ ] Reportes
- [ ] Auditoría

---

## 14. Checklist primera venta

1. ADMIN inicia sesión en `/login`.  
2. Crear vendedor en `/admin/usuarios`.  
3. Vendedor inicia sesión en `/login` → `/venta`.  
4. Vendedor crea ticket (horas abiertas).  
5. Revisar preview del ticket.  
6. Descargar/compartir PNG.  
7. Cliente escanea QR → `/ticket/[codigoPublico]`.  
8. ADMIN carga resultado en `/admin`.  
9. Cliente vuelve a consultar el ticket (estado/premio derivados).  
10. ADMIN revisa exposición / reportes / auditoría.

---

## 15. Riesgos conocidos

| Riesgo | Severidad |
| --- | --- |
| Sin rate limit login / consulta pública | No bloqueante (V2) |
| CSRF sin token dedicado | No bloqueante (`SameSite=lax`) |
| `codigoPublico` conocido = lectura del ticket | Diseño aceptado |
| Mezclar TEST y prod por error humano | Mitigado por guards en scripts test |
| EPERM Prisma generate en Windows con Next abierto | Operativo local |

---

## 16. Pendientes V2

- Rate limiting, CSRF estricto, 2FA, recuperación email  
- Topes de apuesta, ventana de anulación  
- Impresión térmica, caja/comisiones, WhatsApp API  
- UI config multiplicador, página dedicada exposición  
- Excel/PDF/gráficos  

Ver también `docs/v1-final-status.md`.

---

## 17. Modo LAN / dev:test

`npm run dev:test` y `npm run dev:test:lan` son **solo** herramientas de desarrollo/prueba manual contra `TEST_DATABASE_URL`.  

**No** usar en producción.  
**No** requeridos por `npm run build` ni por el runtime de producción.

---

## 18. Dinero / concurrencia / timezone

- Sin `parseFloat`/`parseInt` en cálculos monetarios de `lib/` (importe/total/premio/exposición usan Decimal / strings canónicos).  
- Numeración: `TicketCounter` atómico (no `count+1`).  
- Idempotencia: `idempotencyKey` UNIQUE + hash.  
- Zona autoritativa: `America/Caracas` + `HORAS_SORTEO` en servidor.

---

## 19. Dependencias

**Producción (`dependencies`):** `next`, `react`, `react-dom`, `@prisma/client`, `prisma`, `bcryptjs`, `html-to-image`, `qrcode.react`.  

**Dev/test (`devDependencies`):** TypeScript, ESLint, Tailwind, `tsx`, types.  

No se actualizaron versiones en este preflight.

---

## 20. Vercel / pipeline

- Build: `prisma generate && next build`  
- Postinstall: `prisma generate`  
- El repositorio **incluye** `vercel.json` con cron Vercel: ruta `/api/cron/resultados-automaticos`, schedule `*/5 * * * *`. Revisar ese archivo junto con la ruta del endpoint y la presencia de `CRON_SECRET` en el entorno Production **antes** de asumir automatización.  
- **No verificado en producción:** que el cron esté desplegado, programado o ejecutándose con éxito. La presencia de `vercel.json` en el repo ≠ cron productivo operativo.  
- Sin `CRON_SECRET` (o vacío): el código rechaza la petición (**fail-closed**); no hay bypass.  
- Pipeline **no** ejecuta seeds ni suites de integración/aceptación  

Migraciones: aplicar manualmente / job de release con `prisma migrate deploy` **antes o en el release**, solo con autorización humana; no dejar datos de test en prod. **No** se recomienda ejecutar migraciones en esta fase documental.

---

## 21. Correcciones en este preflight

Ninguna de código: no se detectó bloqueador de producción en runtime.  
Único incidente: EPERM local de Prisma generate (proceso bloqueando el engine) — resuelto liberando el proceso y reejecutando build.

---

## 22. Estado final

**Implementado en código (local):** auth moderna, tickets, resultados (incl. publicación canónica / cron autenticado), bootstrap prod con dual opt-in, guard Neon, runner unitario aislado.  

**Unitarios:** cifra reportada PROMPT 151 = 385 PASS en árbol de trabajo local (ver §2); no sustituye verificación en commit limpio ni en CI.  

**Pendiente / no demostrado aquí:** despliegue productivo, cron operativo en Vercel, migraciones aplicadas en prod, bootstrap ADMIN en prod, integración/aceptación reejecutadas, smoke UI prod.  

**Criterio operativo:** completar el checklist (§13) con HTTPS, migraciones y bootstrap ADMIN **solo** bajo autorización humana explícita, sin mezclar `TEST_DATABASE_URL` en el runtime.
