# Arquitectura del módulo de tickets — Lotería La Jungla

Documento de diseño. **No implementa** código, migraciones ni cambios al sistema existente.

Basado en la auditoría del proyecto actual (Next.js 14 App Router, Prisma 5, PostgreSQL/Neon, `Animal` / `Resultado`, `lib/fecha.ts`, admin por cookie).

---

## 1. Objetivo

Diseñar un módulo de **emisión, consulta, liquidación y exposición de tickets** integrado en la misma aplicación Next.js + Prisma + PostgreSQL, sin romper:

- página pública de resultados (`/`);
- panel de carga de resultados (`/admin`);
- modelos `Animal` y `Resultado`;
- lógica de zona horaria `America/Caracas` (`lib/fecha.ts`).

El ticket al cliente muestra **solo lo jugado** (líneas + total). El **multiplicador 30×**, premios y exposición son **internos/admin**.

---

## 2. Arquitectura propuesta

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js 14 (App Router) — misma app                        │
│                                                             │
│  Público          Vendedor              Admin               │
│  /                /venta                /admin (existente)  │
│  /ticket/[codigo] /venta/tickets/...    /admin/tickets      │
│                                     /admin/exposicion/...   │
│                                                             │
│  APIs: /api/tickets/...  /api/admin/tickets/...             │
│        /api/admin/exposicion/...                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Prisma + PostgreSQL (Neon)                                 │
│  Animal, Resultado  (existentes, no duplicar)               │
│  Ticket, TicketLinea, TicketCounter, ConfigNegocio, Usuario │
│  (futuros)                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Principios**

| Principio | Detalle |
|-----------|---------|
| Una sola app | Sin microservicio ni repo aparte |
| Servidor como fuente de verdad | Totales, premios, exposición, numeración: solo en backend |
| Soft-delete lógico | Anulación = estado + auditoría, nunca `DELETE` físico |
| Reutilizar dominio existente | `HORAS_SORTEO`, `Animal.numero`, `Resultado` por `@unique([fecha,hora])` |
| Separación cliente/interno | Ticket imagen/QR ≠ panel liquidación |

**Capas lógicas futuras (sin crearlas aún)**

- `lib/tickets/` — numeración, creación, liquidación, exposición.
- `lib/config/` — lectura del multiplicador.
- `components/tickets/` — UI de venta y ticket visual.
- Extensión de auth hacia roles (diseño §11); **auth actual no se cambia ahora**.

---

## 3. Modelo Ticket

### 3.1 Campos conceptuales

| Campo | Propósito |
|-------|-----------|
| `id` | Identificador interno (cuid/uuid). PK opaca. |
| `numeroVisible` | Número legible único (ej. `LJ-20260930-000125`). Cliente y soporte. |
| `codigoPublico` | Token aleatorio seguro (URL/QR). Independiente del número. |
| `fechaJuego` | Día de juego (`@db.Date`, mismo criterio que `Resultado.fecha`). Una sola fecha por ticket. |
| `vendedorId` | Quién emitió (futuro `Usuario`; hasta entonces nullable o placeholder). |
| `createdAt` | Momento de emisión (UTC). |
| `totalApostado` | Suma de importes de líneas **persistida al crear** (inmutable salvo reglas futuras explícitas). |
| `estado` | Al menos `EMITIDO` \| `ANULADO`. |
| `anuladoAt` | Timestamp de anulación (null si activo). |
| `anuladoPorId` | Admin que anuló (null si activo). |
| `motivoAnulacion` | Texto opcional de auditoría. |
| `multiplicadorUsado` | Snapshot del multiplicador vigente **al emitir** (ej. `30`), para liquidar con la regla del momento de la venta. |
| `updatedAt` | Auditoría genérica. |

### 3.2 Qué se almacena vs qué se calcula

| Almacenar | Calcular (no mostrar en ticket imagen) |
|-----------|----------------------------------------|
| Líneas, importes, total apostado | Premio por línea = `importe × multiplicadorUsado` si ganó |
| Estado `EMITIDO` / `ANULADO` | “Ganador / no ganador / pendiente” a partir de `Resultado` + líneas |
| Snapshot multiplicador al emitir | Premio total del ticket = suma premios de líneas ganadoras |
| Quién/cuándo anuló | Exposición por animal (suma importes × multi de tickets no anulados) |

**No almacenar** un “premio mostrado al cliente”.  
**Sí** puede almacenarse, tras liquidación o de forma derivada, campos internos opcionales de liquidación (ver §10 y §14) para no recalcular todo en cada vista admin — o calcular on-the-fly; ver decisión pendiente.

---

## 4. Modelo TicketLinea

Cada línea = **una apuesta** = `fechaJuego` (heredada del ticket) + `hora` + `animal` + `importe`.

| Campo | Propósito |
|-------|-----------|
| `id` | PK interna |
| `ticketId` | FK → Ticket |
| `hora` | Int ∈ `HORAS_SORTEO` (9–19) |
| `numeroAnimal` | FK → `Animal.numero` (String) |
| `nombreAnimalSnapshot` | Nombre al momento de la venta (histórico) |
| `importe` | Decimal/centavos (ver §25) |
| `createdAt` | Opcional / herencia del ticket |

**Restricción de unicidad (obligatoria)**

```text
@@unique([ticketId, hora, numeroAnimal])
```

Impide dos líneas idénticas en el mismo ticket.  
El mismo animal **sí** puede repetirse en **horas distintas**.

**Índice de exposición / liquidación**

```text
@@index([fechaJuego, hora, numeroAnimal])  // denormalizar fechaJuego en la línea
```

**Recomendación:** denormalizar `fechaJuego` en `TicketLinea` (copiada del ticket al crear, inmutable) para consultas `FECHA + HORA + ANIMAL` sin join, con check de consistencia en transacción de creación.

### Información de premio en la línea

| Enfoque | Descripción |
|---------|-------------|
| **Preferido (fase 1)** | No persistir `premio` ni `esGanadora`. Calcular al leer: join/lookup `Resultado` donde `fecha+hora` coincide y `Resultado.numero == numeroAnimal`. |
| **Opcional (fase 2)** | Tras publicar/modificar resultado, materializar `esGanadora` / `premioCalculado` en batch para reportes admin. Debe invalidarse/recalcularse si cambia el resultado (§15). |

---

## 5. Nombre del animal y snapshot histórico

`Animal` ya tiene `numero`, `nombre`, `imagen`. **No crear otra tabla de animales.**

**Decisión: sí, snapshot de nombre en `TicketLinea`.**

| Motivo | Detalle |
|--------|---------|
| Histórico | Si mañana se corrige un nombre en `Animal`, tickets viejos siguen mostrando lo vendido. |
| Ticket autónomo | La imagen/consulta pública no depende de un rename posterior. |
| Auditoría | Coincide con lo que vio el cliente al comprar. |

La FK `numeroAnimal` sigue apuntando a `Animal` para integridad y joins.  
El UI muestra siempre: **`{numero} - {nombreAnimalSnapshot}`** (ej. `03 - Gallo`).  
`imagen` del catálogo no es requisito del ticket en esta fase.

---

## 6. Relaciones con Animal y Resultado

```text
Animal 1 ──< N TicketLinea     (FK numeroAnimal → Animal.numero)
Ticket  1 ──< N TicketLinea
Resultado      (sin FK obligatoria desde TicketLinea)

Liquidación lógica:
  TicketLinea.fechaJuego + TicketLinea.hora  ↔  Resultado.fecha + Resultado.hora
  TicketLinea.numeroAnimal                   ↔  Resultado.numero
```

- **No duplicar** `Animal` ni `Resultado`.
- **No** poner FK de `TicketLinea` → `Resultado` (el resultado puede no existir aún; y `Resultado` es 1 por fecha+hora, no por animal de apuesta).
- Localizar apuestas de un sorteo:

```text
WHERE fechaJuego = :fecha AND hora = :hora AND numeroAnimal = :numero
  AND ticket.estado != ANULADO   -- para exposición/premios
```

---

## 7. Fecha

- Un ticket = **un solo** `fechaJuego`.
- Todas las líneas comparten ese día; varias `hora` del mismo día.
- Validación servidor (reutilizar `lib/fecha.ts`):

| Regla | Cómo |
|-------|------|
| Fecha parseable | `parseFechaYYYYMMDD` |
| Zona Caracas | `hoyYYYYMMDD` / `fechaHoyParaPrisma` para “hoy” |
| Horas válidas | `hora ∈ HORAS_SORTEO` |
| Sin fechas futuras (venta) | Recomendado: `fechaJuego ≤ hoy VE` (igual espíritu que la home) |
| Consistencia | En create: todas las líneas usan la misma `fechaJuego` |

Regla exacta de “¿se puede vender para días pasados?” → **decisión pendiente** (§25).

---

## 8. Número de ticket

### Formato propuesto

```text
LJ-YYYYMMDD-NNNNNN
```

Ejemplo: `LJ-20260930-000125`

- Prefijo marca `LJ`
- Día de juego (o día de emisión; **recomendación: día de juego** = `fechaJuego`)
- Secuencia diaria de 6 dígitos

### Concurrencia (evitar colisiones entre vendedores)

Tabla auxiliar **`TicketCounter`**:

| Campo | Uso |
|-------|-----|
| `fechaJuego` | PK (`@db.Date`) |
| `ultimo` | Int, último número asignado ese día |

En la **misma transacción** de creación del ticket:

1. `SELECT … FOR UPDATE` / `upsert` del contador del día.
2. `ultimo = ultimo + 1`.
3. Formatear `numeroVisible`.
4. Insertar `Ticket` + `TicketLinea[]`.
5. Commit.

Alternativa PostgreSQL: secuencia por día o `advisory lock` por clave `fechaJuego`.  
**No** generar el número solo en el cliente.  
**No** usar `count(*)+1` sin bloqueo.

---

## 9. Código público y QR

| | Número visible | Código público |
|--|----------------|----------------|
| Propósito | Identificación humana / soporte | Acceso URL / QR |
| Formato | `LJ-20260930-000125` | Token opaco (ej. 22–32 chars `base64url` / nanoid) |
| Predecible | Parcialmente (secuencia) | No |
| Único | Sí (`@@unique`) | Sí (`@@unique`) |
| En ticket imagen | Sí | Embebido en QR (URL), no hace falta imprimir el string largo |

URL:

```text
https://{DOMINIO}/ticket/{codigoPublico}
```

La **página** `/ticket/[codigo]` puede mostrar estado/ganador (consulta).  
El **arte/PNG del ticket para WhatsApp** no muestra premio ni 30×; el QR solo apunta a la URL.

Generación: CSPRNG en servidor al crear el ticket; verificar unicidad (retry si colisión improbable).

---

## 10. Estados

### Persistidos en Ticket

| Estado | Significado |
|--------|-------------|
| `EMITIDO` | Activo; cuenta para exposición y liquidación |
| `ANULADO` | Soft-cancel; excluido de exposición y premios |

### Derivados (por ticket / por línea) — calcular

| Derivado | Regla |
|----------|-------|
| Línea pendiente | No hay `Resultado` para `(fechaJuego, hora)` |
| Línea no ganadora | Hay resultado y `Resultado.numero ≠ numeroAnimal` |
| Línea ganadora | Hay resultado y `Resultado.numero = numeroAnimal` y ticket `EMITIDO` |
| Ticket pendiente | Alguna línea pendiente |
| Ticket no ganador | Todas las líneas resueltas y ninguna ganadora |
| Ticket ganador | ≥1 línea ganadora (premio interno = suma `importe × multiplicadorUsado`) |

Anulado: mostrar “Anulado”; no liquidar.

---

## 11. Usuarios y roles

**Auth de producción:** `Usuario` + `UsuarioSesion` + cookie `lj_session` + `RolUsuario`.

| Rol | Puede | No puede |
|-----|-------|----------|
| ADMIN | Resultados CRUD, exposición, consultar/anular tickets, usuarios, config | — |
| VENDEDOR | Crear tickets, listar los suyos, ver ticket propio, exportar imagen/WhatsApp | Resultados, anular, config, exposición, admin usuarios |

Modelo `Usuario`: `id`, `usuario`, `passwordHash`, `rol` (`ADMIN`\|`VENDEDOR`), `activo`.

Bootstrap del primer ADMIN (script, no runtime): `ADMIN_BOOTSTRAP_USER` + `ADMIN_BOOTSTRAP_PASSWORD`.

Histórico: existió un fallback `admin_session` / `ADMIN_SESSION_SECRET` — **retirado**. Ver `docs/legacy-auth-removal.md`.

Migración de auth (completada):

1. Login con UsuarioSesion / `lj_session`.
2. Legacy (`admin_session`) eliminado del runtime.
3. Anulación: **solo** rol ADMIN en servidor (`anuladoPorId` = admin.id).

El diseño de datos incluye `vendedorId` / `anuladoPorId`.

---

## 12. Punto de venta

Pantalla independiente (ej. `/venta`), flujo:

1. Elegir fecha  
2. Seleccionar una o varias horas (`HORAS_SORTEO`)  
3. Por cada hora, seleccionar animales + importe  
4. Resumen agrupado  
5. Total jugado (suma cliente solo orientativa; servidor recalcula)  
6. Confirmar → API crea ticket  
7. Mostrar ticket visual + QR  
8. (Luego) imagen / WhatsApp  

**Modelo de UI en memoria (sin duplicar):**

```text
Map<hora, Map<numeroAnimal, importe>>
→ al confirmar: aplanar a TicketLinea[]
```

Validaciones cliente = UX; **validación autoritativa en servidor**.

---

## 13. Representación visual del ticket

Contenido visible:

- Marca Lotería La Jungla  
- `numeroVisible`  
- Fecha de juego  
- Bloques por hora → `numero - nombre` → importe  
- **TOTAL JUGADO**  
- QR → `/ticket/{codigoPublico}`  

**No mostrar:** 30×, premio potencial, exposición, ganancia.

### Estrategia imagen (Next.js / Vercel) — diseño, no implementar

| Opción | Pros | Contras |
|--------|------|---------|
| **A. `@vercel/og` / ImageResponse** | Nativo Vercel, edge | Layout limitado |
| **B. Componente HTML + `html-to-image` en cliente** | Control visual Tailwind | Depende del browser del vendedor |
| **C. Playwright/Puppeteer** | Fidelity alta | Pesado; no ideal en serverless Hobby |

**Recomendación fase 1:** ticket como componente React imprimible/compartible; fase 2 cliente `html-to-image` o ruta OG. Sin librería instalada en este documento.

WhatsApp: vendedor descarga/comparte PNG; no hay impresión física por ahora.

---

## 14. Resultados y liquidación

Cuando ADMIN publica `Resultado(fecha, hora, numero)`:

1. Índice: líneas con `(fechaJuego, hora, numeroAnimal)` y tickets `EMITIDO`.  
2. Esas líneas son ganadoras.  
3. Premio línea = `importe × multiplicadorUsado` (del ticket; hoy 30).  
4. Premio ticket = suma de líneas ganadoras de ese ticket (posiblemente varias horas).  

Todo **interno / admin / página de consulta** según producto; **no** en PNG del ticket de venta.

---

## 15. Modificación de resultados

Si ADMIN cambia el animal de un `Resultado` existente (`upsert` actual):

| Estrategia | Detalle |
|------------|---------|
| **A. Cálculo siempre derivado** | No hay premios stale: cada consulta recalcula vs `Resultado` actual. Más simple y consistente. |
| **B. Materializado** | Job/transacción: limpiar flags de la hora antigua y marcar nueva; actualizar agregados. |

**Recomendación:** empezar con **A**. Si más adelante se materializa, toda escritura a `Resultado` debe disparar recálculo de `(fecha, hora)` en la misma transacción o cola.

Auditoría futura deseable: historial de cambios de resultado (hoy `Resultado` solo guarda el valor actual).

---

## 16. Exposición y riesgo

Pantalla admin **antes** de cargar resultado de una hora (ej. `/admin/exposicion?fecha=&hora=`):

Para cada `Animal` con apuestas ese `fecha+hora` (tickets `EMITIDO`):

| Columna | Fórmula |
|---------|---------|
| Jugado | `SUM(TicketLinea.importe)` |
| Exposición 30× | `Jugado × multiplicadorVigente` (o el de config; ver §17) |
| Tickets afectados | `COUNT(DISTINCT ticketId)` |

Agregados:

- Total apostado al sorteo  
- Exposición máxima = max exposición por animal (o suma — **definir en §25**; típicamente **máxima** = el peor animal si solo gana uno)  
- Como solo hay un ganador por hora (`Resultado` unique fecha+hora), la **exposición real a pagar esa hora** = exposición del animal ganador; la tabla muestra el riesgo **por animal** para decidir.

**Solo tickets no anulados.**  
**Nunca** en el ticket del cliente.

---

## 17. Configuración del multiplicador 30×

**Una sola fuente de verdad.** No hardcodear `30` en UI ni en múltiples servicios.

### Propuesta: tabla `ConfigNegocio`

| Campo | Ejemplo |
|-------|---------|
| `clave` | `MULTIPLICADOR_PREMIO` (PK) |
| `valorEntero` | `30` |
| `updatedAt` / `updatedPorId` | Auditoría |

Lectura: `lib/config/getMultiplicador()` → cache corta opcional.

Al **crear ticket**: copiar valor a `Ticket.multiplicadorUsado`.  
Al **calcular exposición del momento**: usar config vigente (o política “mismo multi que tickets abiertos”; ver §25).

Seed inicial: insertar `30`.  
Admin futuro: pantalla de configuración (solo ADMIN).

---

## 18. Seguridad

| Riesgo | Mitigación |
|--------|------------|
| Manipular importes en el cliente | Servidor recalcula `totalApostado` y valida importes > 0, máximos, moneda |
| Tickets duplicados / doble submit | Idempotency-Key opcional; unicidad DB; transacción |
| Enumerar `LJ-…` | Consulta pública **solo** por `codigoPublico`; número visible no basta para URL |
| Enumerar códigos | Entropía alta; rate limit en `/ticket/[codigo]` y APIs |
| Vendedor anula | Rol + check servidor; UI no es control de acceso |
| Exposición filtrada | Solo ADMIN |
| Condiciones de carrera numeración | `TicketCounter` + `FOR UPDATE` |
| Anulación tras pago | Regla de ventana temporal pendiente; auditar siempre |
| XSS en motivo anulación | Sanitizar/escapar en UI |
| CSRF | Cookies `SameSite`; tokens en APIs mutadoras cuando haya sesión real |

Cálculos de premio/exposición/total: **solo servidor**.

---

## 19. APIs futuras (conceptual)

### Público

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tickets/public/[codigo]` | Detalle consulta (líneas, estado, opcionalmente liquidación para la web) |

### Vendedor

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/venta/tickets` | Crear ticket (body: fecha, líneas) |
| GET | `/api/venta/tickets` | Listado propio / filtros básicos |
| GET | `/api/venta/tickets/[id]` | Detalle interno por id (sesión vendedor) |

### Admin

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/tickets` | Listado global, filtros fecha/vendedor/estado |
| GET | `/api/admin/tickets/[id]` | Detalle + liquidación interna |
| POST | `/api/admin/tickets/[id]/anular` | Soft-anular |
| GET | `/api/admin/exposicion` | Query `fecha`, `hora` → tabla riesgo |
| GET/PATCH | `/api/admin/config/multiplicador` | Leer/actualizar 30× |

Las rutas actuales `/api/admin/login|logout|resultados` **se mantienen**; resultados seguirán siendo el disparador lógico de liquidación derivada.

---

## 20. Rutas futuras (UI)

| Ruta | Audiencia | Uso |
|------|-----------|-----|
| `/venta` | Vendedor | Punto de venta |
| `/venta/tickets` | Vendedor | Historial |
| `/venta/tickets/[id]` | Vendedor | Detalle + imagen |
| `/ticket/[codigo]` | Público (QR) | Consulta |
| `/admin/tickets` | Admin | Gestión |
| `/admin/tickets/[id]` | Admin | Detalle + anular |
| `/admin/exposicion` | Admin | Riesgo por sorteo |
| `/admin` | Admin | Resultados (existente, intacto) |
| `/` | Público | Resultados (existente, intacto) |

---

## 21. Índices

| Índice | Sobre | Para |
|--------|-------|------|
| `Ticket.numeroVisible` | UNIQUE | Búsqueda humana |
| `Ticket.codigoPublico` | UNIQUE | QR / consulta |
| `Ticket(fechaJuego)` | INDEX | Listados del día |
| `Ticket(vendedorId, createdAt)` | INDEX | Tickets del vendedor |
| `Ticket(estado, fechaJuego)` | INDEX | Excluir anulados en agregados |
| `TicketLinea(ticketId)` | INDEX (FK) | Líneas del ticket |
| `TicketLinea(ticketId, hora, numeroAnimal)` | UNIQUE | Anti-duplicado |
| `TicketLinea(fechaJuego, hora, numeroAnimal)` | INDEX | Exposición + liquidación |
| `TicketLinea(fechaJuego, hora)` | INDEX | Todas las apuestas de un sorteo |
| `TicketCounter(fechaJuego)` | PK | Numeración |
| `ConfigNegocio(clave)` | PK | Multiplicador |

---

## 22. Concurrencia

| Escenario | Enfoque |
|-----------|---------|
| Dos vendedores crean a la vez | Transacción: lock contador día → insert ticket+líneas |
| Admin carga resultado mientras hay ventas | Lecturas de exposición con snapshot de transacción (`READ COMMITTED` default); resultado unique por fecha+hora evita dos ganadores |
| Anulación vs consulta | Update estado atómico; consultas filtran `EMITIDO` |
| Cambio de resultado con “ganadores” previos | Con cálculo derivado, la verdad cambia al instante; con materializado, update en misma TX que el upsert de `Resultado` |

Usar **`$transaction`** de Prisma (interactive preferred para contador).  
Nivel aislamiento PostgreSQL por defecto suele bastar; documentar `Serializable` solo si aparecen anomalías.

---

## 23. Integración

| Existente | Integración |
|-----------|-------------|
| `/` resultados | Sin cambios de contrato; tickets no aparecen ahí |
| `/admin` resultados | Añadir **enlaces** futuros a exposición/tickets; no reescribir el formulario actual en esta fase |
| `Animal` | FK desde líneas + seed intacto |
| `Resultado` | Fuente de verdad del animal ganador por franja |
| `lib/fecha.ts` | Validación fecha/hora Caracas |
| Auth cookie admin | Se mantiene; venta/roles después |
| Neon pooled/direct | Mismas URLs Prisma |

Despliegue: mismas migraciones Prisma en el mismo proyecto Vercel.

---

## 24. Migraciones futuras (orden sugerido)

1. `ConfigNegocio` + seed multiplicador `30`.  
2. `TicketCounter`.  
3. `Ticket` + `TicketLinea` (+ índices/uniques).  
4. (Opcional) `Usuario` + backfill `vendedorId`.  
5. (Opcional) materialización de liquidación / historial de cambios de `Resultado`.

**No ejecutar** en esta tarea.

---

## 25. Decisiones pendientes

(Ver sección final consolidada.)

---

## DECISIONES QUE NECESITO DEL ARQUITECTO

Solo lo realmente pendiente:

1. **¿Se puede vender para fechas pasadas o solo hoy (y opcionalmente futuro inmediato)?**  
2. **Importes:** ¿enteros (bolívares/USD sin centavos) o `Decimal` con 2 decimales? ¿Moneda única?  
3. **Límite máximo de importe por línea / por ticket / por animal-hora.**  
4. **Ventana de anulación:** ¿hasta cuántos minutos antes del sorteo de la línea / del primer sorteo del ticket / solo si ningún resultado de sus horas está publicado?  
5. **Exposición “máxima” en UI:** ¿mostrar el máximo entre animales (riesgo del peor caso de esa hora) o también la suma informativa?  
6. **Consulta pública `/ticket/[codigo]`:** ¿muestra si ganó y cuánto, o solo jugado + “consultar en taquilla”? (El PNG de WhatsApp igual no muestra premio.)  
7. **¿Quién puede listar tickets ajenos?** Vendedor solo los suyos vs admin todos.  
8. **Multiplicador al liquidar tickets viejos:** confirmar snapshot `multiplicadorUsado` en ticket (recomendado) vs siempre el config actual.  
9. **¿Materializar premios en DB en v1 o solo cálculo derivado?** (Recomendación: derivado.)  
10. **Auth vendedores:** ¿cuándo se introduce `Usuario`/roles respecto a la primera versión del POS?

---

*Fin del documento de arquitectura. Ningún archivo de aplicación, schema ni API fue modificado por esta tarea; solo se creó este markdown.*
