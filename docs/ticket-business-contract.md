# Contrato funcional — sistema de tickets

**Documento:** `docs/ticket-business-contract.md`  
**Naturaleza:** auditoría funcional del comportamiento **implementado hoy**.  
**Alcance:** no inventa reglas; no modifica código.  
**Fuentes:** `lib/tickets/*`, `app/api/**`, `components/tickets/*`, `lib/auth/*`, `prisma/schema.prisma`, seed.

---

## 1. Propósito

Este documento es el **contrato funcional** del sistema de tickets de Lotería La Jungla.

Sirve para:

- congelar las reglas ya aprobadas e implementadas;
- orientar futuras modificaciones sin romper garantías;
- señalar contradicciones entre documentación antigua y el código actual **sin corregirlas aquí**.

Si una regla no aparece aquí, no debe asumirse.

---

## 2. Creación

### Quién puede crear

| Actor | ¿Puede crear? |
| --- | --- |
| Anónimo | No |
| VENDEDOR (sesión `lj_session`) | Sí |
| ADMIN (sesión `lj_session`) | Sí |

API: `POST /api/venta/tickets` → `requireVendorOrAdmin()`.

### Fecha permitida

Solo la fecha de **hoy** en zona `America/Caracas` (`YYYY-MM-DD`).

Cualquier otra fecha → error de dominio (`InvalidGameDateError` → HTTP 400).

### Horas permitidas

- Catálogo: `HORAS_SORTEO` = enteros **9 … 19** (11 sorteos/día).
- Además debe estar **abierta** para venta (ver §5).

### Animales permitidos

- `numeroAnimal` string no vacío.
- Debe existir en la tabla `Animal`.
- Al emitir se guarda `nombreAnimalSnapshot` = `Animal.nombre` en ese momento.

### Importes

- Valor **> 0**.
- Máximo **2 decimales**.
- Representación canónica: `Prisma.Decimal` / `Decimal(12,2)`.
- **No** hay tope máximo de importe implementado.

### Combinación hora + animal

Dentro de un mismo ticket, la pareja `(hora, numeroAnimal)` es **única**.

Duplicado → `DuplicateTicketLineError`.

### Total

- Calculado **solo en servidor**: suma de importes de líneas.
- El cliente **no** puede imponer `totalApostado` (campo prohibido en el body).

### Multiplicador snapshot

- Se lee `ConfigNegocio` clave `MULTIPLICADOR_PREMIO` (`valorInt`).
- Seed inicial: **30**.
- Se copia a `Ticket.multiplicadorUsado` en la misma transacción de emisión.
- El cliente **no** puede enviar `multiplicador` / `multiplicadorUsado`.

### Número visible

Formato:

```text
LJ-YYYYMMDD-NNNNNN
```

Ejemplo: `LJ-20261002-000001`.

Secuencia diaria 1-based, 6 dígitos, vía `TicketCounter`.

### Código público

- Opaco, generado con CSPRNG (`randomBytes` → base64url).
- Único en DB.
- Usado para QR y consulta pública (no es el `numeroVisible`).

### Idempotencia

- `idempotencyKey`: UUID obligatorio (normalizado a minúsculas).
- `idempotencyRequestHash`: SHA-256 canónico de fecha + líneas (hora, animal, importe).
- Ver §17.

### Vendedor asociado

- `Ticket.vendedorId` = `Usuario.id` de la sesión autenticada.
- El `vendedorId` del body JSON se **ignora** (`parseCreateTicketBody` fuerza `null`; la API asigna la sesión).

### Estado inicial

`EMITIDO`.

### Campos prohibidos en el body de creación

`totalApostado`, `multiplicador`, `multiplicadorUsado`, `premio`, `exposicion`, `estado`, `numeroVisible`, `codigoPublico`, `id`, `idempotencyRequestHash`.

---

## 3. Inmutabilidad

### Datos de venta (no cambian tras emitir)

| Campo | ¿Mutable tras emitir? |
| --- | --- |
| Líneas (`TicketLinea`) | No (ni borrar ni editar) |
| Importes de línea | No |
| `fechaJuego` | No |
| Horas de líneas | No |
| `numeroAnimal` | No |
| `nombreAnimalSnapshot` | No |
| `totalApostado` | No |
| `multiplicadorUsado` | No |
| `numeroVisible` | No |
| `codigoPublico` | No |
| `vendedorId` | No |
| `idempotencyKey` / `idempotencyRequestHash` | No |

### Estado administrativo (sí puede cambiar)

| Campo | Cambio permitido |
| --- | --- |
| `estado` | `EMITIDO` → `ANULADO` (una sola vez) |
| `anuladoAt` | Se escribe en la primera anulación |
| `motivoAnulacion` | Se escribe en la primera anulación |
| `anuladoPorId` | ID del ADMIN que anula |
| `updatedAt` | Automático Prisma |

**Distinción clave:** la anulación es un cambio de **estado administrativo**, no una reedición de la venta.

---

## 4. Anulación

### Quién puede anular

Solo **ADMIN** con sesión válida.

API: `POST /api/admin/tickets/[id]/anular` → `requireAdmin()`.

VENDEDOR: no tiene endpoint de anulación (403 en APIs admin).

### Cómo se registra

Body: `{ "motivo": "…" }`

- Motivo obligatorio tras `trim`.
- Longitud 1 … **500** caracteres.

### Qué campos cambian

Condicional atómica:

```text
UPDATE … WHERE id = X AND estado = 'EMITIDO'
```

Escribe: `estado=ANULADO`, `anuladoAt`, `motivoAnulacion`, `anuladoPorId`.

Segundo intento → `TicketAlreadyAnuladoError` (HTTP 409). No sobrescribe auditoría.

### Qué no se elimina

- Fila `Ticket`.
- Filas `TicketLinea`.
- Datos de venta inmutables (§3).

### Efecto sobre exposición

Los tickets `ANULADO` **no** entran en agregados de exposición (filtro `estado = EMITIDO`).

### Efecto sobre liquidación

- Estado derivado del ticket: `ANULADO`.
- Líneas: nunca `GANADORA` aunque coincida el resultado.
- `premioTotal` = `"0.00"`.

### Efecto sobre consulta pública

La consulta por `codigoPublico` muestra el ticket como `ANULADO` (sin premio).

### Auditoría

- `anuladoPorId` = `Usuario.id` del ADMIN de sesión.
- `anuladoAt` timestamp.
- `motivoAnulacion` texto.

### Ventana temporal de anulación

**Implementación actual: no hay ventana.**

No se restringe por hora de sorteo, ni por existencia de `Resultado`, ni por antigüedad del ticket.

Cualquier ticket `EMITIDO` puede anularse mientras exista y el actor sea ADMIN.

---

## 5. Horas cerradas

### Regla (backend — fuente de verdad)

Una hora está **abierta** para venta solo si:

1. `hora > horaActual` en `America/Caracas`; **y**
2. **no** existe `Resultado` para esa `(fechaJuego, hora)`.

Consecuencias:

| Situación | ¿Acepta apuestas? |
| --- | --- |
| Hora futura sin resultado | Sí |
| Hora **actual** (`hora === horaActual`) | No (`HORA_LLEGADA`) |
| Hora **pasada** | No (`HORA_LLEGADA`) |
| Cualquier hora con `Resultado` | No (`RESULTADO_PUBLICADO`) |

Si **alguna** línea del ticket cae en hora cerrada → se rechaza **todo** el ticket (`DrawClosedError`).

### Frontend

- POS consulta `GET /api/venta/horas-disponibles` y muestra ABIERTA/CERRADO.
- Es orientación UX; **no** es fuente de verdad.
- El servidor revalida en `createTicket`.

### Backend

- Revalidación obligatoria dentro de la transacción de creación.
- Listado de disponibilidad: `lib/tickets/draw-hours.ts` + `get-open-draw-hours`.

---

## 6. Dinero

| Aspecto | Regla actual |
| --- | --- |
| Tipo | `Decimal` / `@db.Decimal(12, 2)` |
| Decimales | Exactamente validación ≤ 2; salidas `toFixed(2)` |
| Total | Suma servidor de importes de línea |
| Float | No se usa como verdad de negocio |

### Qué jamás se acepta del navegador

- `totalApostado`
- `premio` / `premioTotal`
- `multiplicador` / `multiplicadorUsado`
- `exposicion`
- `estado`
- `numeroVisible` / `codigoPublico`
- `vendedorId` como autoridad (se ignora)

El POS puede mostrar un **total orientativo**; el total oficial es el del servidor.

---

## 7. Multiplicador

| Pieza | Rol |
| --- | --- |
| `ConfigNegocio.MULTIPLICADOR_PREMIO` | Valor vigente para **nuevas** emisiones (`valorInt`) |
| Seed / valor inicial documentado | **30** |
| `Ticket.multiplicadorUsado` | Snapshot histórico al emitir |

### Cuándo se copia

En la transacción de `createTicket`, antes de persistir el ticket.

### Tickets antiguos

Siguen usando su `multiplicadorUsado` aunque la config cambie después.

### Cálculos que usan el snapshot

- Premio de línea: `importe × multiplicadorUsado`
- Exposición de línea: `importe × multiplicadorUsado` del ticket de esa línea

### Visibilidad al cliente (ticket de venta / PNG)

El multiplicador **NO** aparece en:

- ticket visual de venta (`TicketPreview`);
- PNG exportado;
- respuesta JSON de `POST /api/venta/tickets` (`toVentaTicketResponse`).

Sí puede verse en **detalle admin** (`get-admin-ticket` incluye `multiplicadorUsado`) — superficie administrativa, no el ticket del apostador.

---

## 8. Ticket visual

Componente: `components/tickets/TicketPreview.tsx`.

### Contiene

- Marca: **Lotería La Jungla**
- Título: **TICKET**
- `numeroVisible`
- Fecha de juego (formato UI)
- Por cada hora: número + nombre de animal (`nombreAnimalSnapshot`) + importe
- **TOTAL JUGADO** (`totalApostado`)
- QR (hacia `/ticket/{codigoPublico}`)

### NO contiene

- `30×` / multiplicador
- premio / ganancia
- exposición / riesgo
- datos de vendedor
- tokens / hashes
- `codigoPublico` en texto visible (solo embebido en la URL del QR)

---

## 9. PNG

| Aspecto | Implementación |
| --- | --- |
| Librería | `html-to-image` (`toBlob`) |
| Origen | Captura del DOM de `TicketPreview` |
| QR | Incluido (`QRCodeCanvas`) |
| `pixelRatio` | `2` |
| Fondo | `#022c22` |
| Nombre archivo | `ticket-{numeroVisible}.png` |
| Descarga | `<a download>` con blob URL |
| Web Share | Si `navigator.share` + `canShare({ files })` → comparte `File` PNG |
| Sin Web Share | Solo descarga (botón compartir no aplicable / fallback a descarga según UI) |
| Filtro export | Nodos con `data-export-hide="true"` no entran al PNG |

Archivos: `TicketImageActions.tsx`, `ticket-image.ts`.

---

## 10. QR

| Aspecto | Regla |
| --- | --- |
| Identificador | `codigoPublico` (opaco) |
| URL | `{origin}/ticket/{codigoPublico}` |
| vs `numeroVisible` | El visible es humano (`LJ-…`); **no** sirve para la consulta pública por código |
| Uso | Solo lectura / consulta |
| Modificación | El QR **no** autoriza crear, editar ni anular |

Seguridad: conocer `codigoPublico` permite ver el ticket público; no otorga sesión ni rol.

---

## 11. Consulta pública

### Superficies

| Tipo | Ruta |
| --- | --- |
| Página | `/ticket/[codigo]` |
| API | `GET /api/tickets/public/[codigo]` |

Lookup **solo** por `codigoPublico` (no por `numeroVisible`).

### Puede ver

- Identidad del ticket (`id`, `numeroVisible`, `fechaJuego`, `createdAt`)
- Líneas (hora, animal, nombre snapshot, importe)
- Estado **derivado** de liquidación
- Resultados asociados a las horas (cuando existen)
- `premioTotal` y premios por línea cuando correspondan
- Flag `liquidacionCompleta`

### NO puede ver

- `vendedorId` / datos del vendedor
- exposición / riesgo agregado
- `multiplicadorUsado`
- `anuladoPorId`, `motivoAnulacion` (como campos admin; el estado `ANULADO` sí se refleja)
- `idempotencyKey` / hashes
- tokens / cookies / passwordHash
- catálogo interno de configuración

---

## 12. Liquidación

Liquidación **derivada** en lectura: no se materializa un “premio guardado” editable en el ticket.

### Por línea (`EstadoLineaPublico`)

| Estado | Significado |
| --- | --- |
| `PENDIENTE` | Sin `Resultado` para esa hora |
| `GANADORA` | Resultado coincide con `numeroAnimal` y ticket no anulado |
| `NO_GANADORA` | Hay resultado y no coincide (o anulado → nunca ganadora) |

Premio de línea ganadora:

```text
importe × multiplicadorUsado
```

### Por ticket (`EstadoTicketPublico`)

| Estado | Regla |
| --- | --- |
| `ANULADO` | `Ticket.estado = ANULADO` (prioridad) |
| `PENDIENTE` | Alguna línea aún pendiente |
| `GANADOR` | Todas resueltas y ≥1 ganadora |
| `NO_GANADOR` | Todas resueltas y ninguna ganadora |

`premioTotal` = suma de premios de líneas `GANADORA` (anulado → `"0.00"`).

Persistidos en DB solo: `EMITIDO` | `ANULADO`.

---

## 13. Cambio de resultado

ADMIN puede crear/actualizar `Resultado` (`POST /api/admin/resultados`, upsert por fecha+hora).

**No** se modifican `TicketLinea` ni `multiplicadorUsado`.

Al volver a consultar el ticket (público o admin), la liquidación se **recalcula**:

Ejemplo implementado y verificado en acceptance:

1. Línea `03` × `$5`, multiplicador 30 → con resultado `03` → `GANADORA`, premio `$150.00`.
2. ADMIN cambia resultado a `05`.
3. Misma línea pasa a `NO_GANADORA`, premio ticket `$0.00`.

Esto confirma el modelo de **liquidación derivada**.

---

## 14. Exposición

API: `GET /api/admin/exposicion?fecha=YYYY-MM-DD&hora=N` (solo ADMIN).

### Filtros

- Fecha + hora del sorteo.
- Solo líneas cuyo ticket está **`EMITIDO`**.
- Anulados excluidos.

### Por animal

- `totalApostado` (jugado)
- `exposicion` = Σ (`importe × multiplicadorUsado` del ticket)
- `ticketsAfectados` (distinct `ticketId`)

### Totales

- `totalApostado`
- `totalExposicion`
- `mayorExposicion` (máximo entre animales)
- `ticketsAfectados`

Fórmula por línea:

```text
exposición = importe × multiplicadorUsado  (snapshot del ticket)
```

---

## 15. Vendedores

Roles (`RolUsuario`):

| Rol | Descripción |
| --- | --- |
| `ADMIN` | Operación completa administrativa |
| `VENDEDOR` | Emisión y consulta de tickets propios |

Auth: `Usuario` + `UsuarioSesion` + cookie `lj_session`.

Legacy (`admin_session` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`) **retirado** del runtime (ver `docs/legacy-auth-removal.md`).

---

## 16. Propiedad

Campo: `Ticket.vendedorId` → `Usuario.id` (nullable en histórico).

| Actor | Alcance |
| --- | --- |
| VENDEDOR | Solo tickets con `vendedorId ===` su id |
| ADMIN | Todos (incluidos `vendedorId = null`) |
| Ticket ajeno para vendedor | `404` indistinguible (`TicketNotFoundError`) |
| Históricos | Pueden tener `vendedorId = null`; el vendedor **no** los lista |

La propiedad se fija en la emisión desde la sesión; no desde el body.

---

## 17. Idempotencia

Campos:

- `idempotencyKey` (UNIQUE, nullable solo en históricos)
- `idempotencyRequestHash`

### Casos

| Caso | Resultado |
| --- | --- |
| Misma key + mismo usuario + mismo hash | **Replay**: mismo ticket, HTTP 200, `idempotentReplay: true` |
| Misma key + mismo usuario + body distinto | **409** `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| Misma key + otro usuario | **409** `IDEMPOTENCY_CONFLICT` (mensaje genérico; no filtra el ticket) |
| Key nueva | Ticket nuevo |

### Concurrencia de la misma key

Varias solicitudes paralelas con misma key+usuario+body → **exactamente un** `Ticket` (unicidad DB + manejo de `P2002`).

El replay **no** consume una secuencia adicional del contador (fast-path / rollback de TX perdedora).

---

## 18. Concurrencia

### Mecanismo

Tabla `TicketCounter` (`fechaJuego` PK, `ultimoNumero`).

En la misma transacción de creación:

```sql
INSERT INTO "TicketCounter" ("fechaJuego", "ultimoNumero")
VALUES ($fecha, 1)
ON CONFLICT ("fechaJuego")
DO UPDATE SET "ultimoNumero" = "TicketCounter"."ultimoNumero" + 1
RETURNING "ultimoNumero"
```

Garantía: atomicidad de PostgreSQL sobre la fila del día.

### Comportamiento verificado

20 creaciones simultáneas para la misma fecha → 20 `numeroVisible` distintos; contador final coherente; sin tickets parciales.

Timeouts de TX Prisma en creación: `maxWait` 20s / `timeout` 30s (soportar Neon bajo carga).

---

## 19. Autenticación

Sistema **único** vigente:

| Pieza | Uso |
| --- | --- |
| `Usuario` | Identidad + `passwordHash` + `rol` + `activo` |
| `UsuarioSesion` | Sesión server-side (`tokenHash`, `expiresAt`) |
| Cookie `lj_session` | Token opaco httpOnly; DB guarda solo hash |
| `RolUsuario` | `ADMIN` \| `VENDEDOR` |

Login: `/login` → usuario + contraseña → crea sesión + cookie.
(`/admin/login` redirige 308 a `/login` por compatibilidad.)

Bootstrap (script, no runtime): `ADMIN_BOOTSTRAP_USER` + `ADMIN_BOOTSTRAP_PASSWORD`.

Desactivación: `activo=false` + borrado de `UsuarioSesion`; al reactivar hace falta login nuevo.

Histórico: existió auth legacy; **ya no autoriza**.

---

## 20. Matriz de permisos

| Función | Público | Vendedor | Admin |
| --- | --- | --- | --- |
| Ver resultados públicos (`/`) | Sí | Sí | Sí |
| Crear tickets | No | Sí | Sí |
| Ver ticket por QR | Sí | Sí | Sí |
| Ver sus tickets | No | Sí | Sí |
| Ver tickets ajenos | No | No | Sí |
| Ver exposición (API/panel) | No | No | Sí |
| Cargar resultado | No | No | Sí |
| Modificar resultado | No | No | Sí |
| Anular ticket | No | No | Sí |
| Gestionar vendedores | No | No | Sí |

### Observación de rutas (no es contradicción de permiso)

La matriz anterior es de **capacidades**. La UI de exposición está embebida en `/admin` (panel); **no** existe página dedicada `/admin/exposicion`, aunque sí existe `GET /api/admin/exposicion`. Ver §24.

---

## 21. APIs

### Tickets / venta / admin

| Método | Ruta | Auth |
| --- | --- | --- |
| `POST` | `/api/venta/tickets` | ADMIN \| VENDEDOR |
| `GET` | `/api/venta/tickets` | ADMIN \| VENDEDOR (vendedor: solo propios) |
| `GET` | `/api/venta/tickets/[id]` | ADMIN \| VENDEDOR (vendedor: solo propios) |
| `GET` | `/api/venta/horas-disponibles` | ADMIN \| VENDEDOR |
| `GET` | `/api/tickets/public/[codigo]` | Público |
| `GET` | `/api/admin/tickets` | ADMIN |
| `GET` | `/api/admin/tickets/[id]` | ADMIN |
| `POST` | `/api/admin/tickets/[id]/anular` | ADMIN |
| `GET` | `/api/admin/exposicion` | ADMIN |
| `POST` | `/api/admin/resultados` | ADMIN |

### Auth / usuarios (relevantes)

| Método | Ruta | Auth |
| --- | --- | --- |
| `POST` | `/api/admin/login` | Público (form usuario+password) |
| `POST` | `/api/admin/logout` | Cookie opcional; invalida sesión |
| `GET` / `POST` | `/api/admin/usuarios` | ADMIN |
| `POST` | `/api/admin/usuarios/[id]/activar` | ADMIN |
| `POST` | `/api/admin/usuarios/[id]/desactivar` | ADMIN |

---

## 22. Rutas UI

| Ruta | Existe | Uso |
| --- | --- | --- |
| `/venta` | Sí | POS creación |
| `/venta/tickets` | Sí | Historial venta |
| `/venta/tickets/[id]` | Sí | Detalle venta |
| `/ticket/[codigo]` | Sí | Consulta pública QR |
| `/admin` | Sí | Resultados + panel exposición |
| `/admin/tickets` | Sí | Listado admin |
| `/admin/tickets/[id]` | Sí | Detalle + anulación |
| `/admin/usuarios` | Sí | Gestión vendedores |
| `/admin/login` | Redirect 308 | Compat → `/login` |
| `/login` | Sí | Login único |
| `/admin/exposicion` | **No** (página) | Capacidad vía `/admin` + API |
| `/admin/reportes` | Sí | Reportes diarios |
| `/admin/auditoria` | Sí | Auditoría |
| `/perfil` | Sí | Cambio de contraseña propia |

Middleware protege `/admin/*` y `/venta/*` exigiendo cookie `lj_session`. `/login` es público. `/admin/login` → 308 `/login`. `/ticket/*` queda fuera del matcher (público).

---

## 23. Pendientes reales

Decisiones / capacidades **aún no definidas o no implementadas** (no confundir con lo ya cerrado):

| Tema | Estado |
| --- | --- |
| Límite máximo de apuesta por línea / ticket | No implementado |
| Cambio / recuperación de contraseña | **Parcial:** change-password + reset ADMIN→VENDEDOR implementados; recuperación por email **no** |
| Rate limit de login | Documentado como pendiente; no implementado |
| CSRF avanzado (más allá de `SameSite=lax` + httpOnly) | No implementado |
| Reportes diarios | **Implementado** (`/admin/reportes`) |
| Cierres de caja / pagos / comisiones | No implementado |
| Impresión térmica nativa | No implementado |
| Ventana temporal de anulación | **No definida**; hoy se puede anular cualquier `EMITIDO` |
| UI dedicada `/admin/exposicion` | No existe (panel en `/admin`) |
| API de cambio de multiplicador por UI | No hay endpoint admin de config en el inventario actual |

### Ya NO son pendientes (definidos)

- Multiplicador de negocio inicial **30×** (config + seed).
- El ticket de venta / PNG **no** muestra premios ni 30×.
- El QR consulta el ticket por `codigoPublico`.
- Auth única: UsuarioSesion / `lj_session`.
- Fecha de juego = hoy Caracas.
- Idempotencia obligatoria (UUID).

---

## 24. Contradicciones detectadas

Comparación: implementación actual vs documentos históricos (`docs/tickets-architecture.md` y notas antiguas).

### CONTRADICCIÓN DETECTADA — Auth en architecture antigua

- **Regla esperada (doc histórico):** cookie `admin_session` / `ADMIN_PASSWORD` como auth vigente.
- **Comportamiento actual:** solo `lj_session` + `UsuarioSesion`.
- **Archivos:** `middleware.ts`, `lib/auth/*`, `docs/legacy-auth-removal.md`.
- **Nota:** la retirada es intencional y documentada; el architecture.md ya se actualizó en parte, pero pueden quedar frases históricas residuales.

### CONTRADICCIÓN DETECTADA — Contador en architecture antigua

- **Regla esperada (doc histórico):** `SELECT … FOR UPDATE` / campo `ultimo`.
- **Comportamiento actual:** `INSERT … ON CONFLICT` sobre `ultimoNumero`.
- **Archivo:** `lib/tickets/create-ticket.ts`.

### CONTRADICCIÓN DETECTADA — Idempotencia “opcional”

- **Regla esperada (borrador antiguo):** idempotencia opcional.
- **Comportamiento actual:** `idempotencyKey` UUID **obligatoria**.
- **Archivos:** `parse-create-ticket-body.ts`, `create-ticket.ts`.

### CONTRADICCIÓN DETECTADA — Fecha de juego “pendiente”

- **Regla esperada (borrador):** decisión de fecha pendiente.
- **Comportamiento actual:** solo hoy Caracas.
- **Archivo:** `ticket-validation.ts`.

### CONTRADICCIÓN DETECTADA — Exposición con “multiplicador vigente”

- **Regla esperada (algunas notas antiguas):** usar config vigente.
- **Comportamiento actual:** snapshot `Ticket.multiplicadorUsado` por ticket.
- **Archivos:** `aggregate-exposure.ts`, `get-exposure.ts`.

### CONTRADICCIÓN DETECTADA — Ruta UI `/admin/exposicion`

- **Matriz/listado solicitado en auditorías:** ruta `/admin/exposicion`.
- **Comportamiento actual:** no hay `app/admin/exposicion/page.tsx`; exposición en panel de `/admin` + API.
- **Archivos:** `app/admin/page.tsx`, `app/api/admin/exposicion/route.ts`.

### No son contradicciones (aclaraciones)

- Consulta pública **sí** muestra premio derivado: correcto para `/ticket/[codigo]`; distinto del ticket visual de venta/PNG.
- Detalle **admin** muestra `multiplicadorUsado`: superficie admin, no viola la regla del ticket de cliente.
- Anulación sin ventana temporal: es el comportamiento vigente, no un bug frente a una regla aprobada distinta (la ventana nunca se implementó).

---

## ESTADO DEL CONTRATO

**APROBADO CON OBSERVACIONES**

### Observaciones

1. Documentación histórica (`tickets-architecture.md` / notas viejas) aún puede describir mecanismos superados (legacy auth, contador FOR UPDATE, idempotencia opcional); el **código** es la fuente de verdad de este contrato.
2. No existe página UI `/admin/exposicion`; la capacidad admin de exposición sí existe vía API y panel en `/admin`.
3. No hay ventana temporal de anulación: cualquier ticket `EMITIDO` es anulable por ADMIN.
4. No hay tope máximo de importe; solo `> 0` y ≤ 2 decimales.

Las reglas operativas críticas (creación, inmutabilidad de venta, anulación administrativa, horas cerradas, dinero Decimal, multiplicador snapshot, ticket sin 30×/premio, QR por `codigoPublico`, liquidación derivada, exposición solo `EMITIDO`, propiedad, idempotencia, concurrencia del contador, auth `lj_session`) están **alineadas entre sí en el código** y quedan fijadas por este documento.
