# Entorno seguro para pruebas manuales

**Objetivo:** poder abrir la app localmente con datos de prueba **solo** en `TEST_DATABASE_URL`.

**Flujo recomendado (sin tocar `DATABASE_URL` / `DIRECT_URL` en `.env`):**

1. Definir `TEST_DATABASE_URL` y `MANUAL_TEST_*` en `.env`.
2. `npm run seed:manual-test`
3. `npm run dev:test`
4. Abrir `http://localhost:3000`

**Nunca** ejecutes `seed:manual-test` ni `dev:test` si `TEST_DATABASE_URL` es la base de producción.

---

## 1. Variables de entorno

En `.env` (local), además de `TEST_DATABASE_URL` aislada:

```env
# Obligatoria y DISTINTA de DATABASE_URL / DIRECT_URL
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/llj_test?sslmode=require

# Credenciales de prueba (mín. 8 caracteres). NO subir a git.
MANUAL_TEST_ADMIN_USER=manual_admin
MANUAL_TEST_ADMIN_PASSWORD=cambia-esta-clave
MANUAL_TEST_VENDOR_USER=manual_vendedor
MANUAL_TEST_VENDOR_PASSWORD=cambia-esta-clave

# Opcional: base URL para imprimir el link público del ticket
MANUAL_TEST_PUBLIC_BASE_URL=http://localhost:3000
```

El script **aborta** si falta alguna contraseña o si `TEST_DATABASE_URL` coincide con `DATABASE_URL` / `DIRECT_URL`.

No pongas contraseñas en este documento ni en el código.

---

## 2. Ejecutar el seed

```bash
cd sorteo-lotto-activo
npm run seed:manual-test
```

Salida típica (sin secretos):

- fecha de juego
- usuarios `manual_admin` / `manual_vendedor` (o los de tus variables)
- `numeroVisible` de tickets
- URL `/ticket/[codigoPublico]`

Idempotente: al re-ejecutar el mismo día reutiliza tickets por `idempotencyKey` estable.

Requisito: al **primer** seed del día hacen falta **≥ 2 horas abiertas** (America/Caracas). Si es tarde y no hay horas futuras, ejecuta más temprano.

---

## 3. Iniciar la aplicación contra TEST

**No modifiques** `DATABASE_URL` ni `DIRECT_URL` en `.env`.

```bash
npm run seed:manual-test
npm run dev:test
```

`dev:test`:

1. Valida que `TEST_DATABASE_URL` exista y sea distinta de prod.
2. Arranca `next dev` en un **proceso hijo** con `DATABASE_URL` / `DIRECT_URL` = `TEST_DATABASE_URL`.
3. **No escribe** en `.env`.

Verás al arrancar:

```
TEST DEVELOPMENT DATABASE
Base de datos: TEST_DATABASE_URL
```

(sin imprimir la URL ni contraseñas).

Abre: `http://localhost:3000`

### Variante LAN (móvil en la misma Wi-Fi)

```bash
npm run dev:test:lan
```

Igual que `dev:test` (misma `TEST_DATABASE_URL`, mismos guards, **no** toca `.env`), pero Next escucha en `0.0.0.0` para que otro dispositivo de la red local pueda abrir la app.

Salida típica:

```
TEST DEVELOPMENT DATABASE
Base de datos: TEST_DATABASE_URL
(.env no se modifica; ...)

Local:
http://localhost:3000

LAN:
http://192.168.x.x:3000

Solo red local de confianza. No uses este modo en Wi-Fi público.
Escucha: 0.0.0.0 (accesible en la misma red Wi-Fi).
```

La IP se obtiene con `os.networkInterfaces()` (IPv4 privada RFC1918). El banner **nunca** imprime `DATABASE_URL`, `TEST_DATABASE_URL`, contraseñas ni tokens.

Abre **Local** (`http://localhost:3000`) o **LAN** (`http://192.168.x.x:3000`). **No** abras `http://0.0.0.0:3000` en el navegador (esa dirección solo sirve para que el servidor escuche; el cliente no puede navegarla).

**Solo red de confianza.** No uses `dev:test:lan` en Wi-Fi público. No uses ngrok, túneles ni port forwarding: solo PC ↔ móvil en la misma LAN.

#### Firewall de Windows (manual)

Si el teléfono no carga la URL LAN, Windows Firewall puede estar bloqueando el puerto 3000. Permítelo **a mano** (no lo automatizamos):

1. Panel de control → Firewall de Windows Defender → Configuración avanzada.
2. Reglas de entrada → Nueva regla → Puerto → TCP → 3000.
3. Permitir la conexión → solo redes **privadas**.
4. Nombre sugerido: `Next.js dev test LAN (3000)`.

O desde PowerShell **como administrador** (opcional, manual):

```powershell
New-NetFirewallRule -DisplayName "Next.js dev test LAN (3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Para desarrollo normal contra la DB de la app (no test):

```bash
npm run dev
```

---

## 4. Usuarios de prueba

| Rol | Usuario por defecto | Login |
| --- | --- | --- |
| ADMIN | `manual_admin` | `/login` → `/admin` |
| VENDEDOR | `manual_vendedor` | `/login` → `/venta` |

Contraseñas: las de `MANUAL_TEST_*_PASSWORD` (nunca se imprimen).

---

## 5. URLs a abrir

| Ruta | Quién |
| --- | --- |
| `/login` | ambos (oficial) |
| `/admin/login` | redirect 308 → `/login` |
| `/admin` | ADMIN (resultados + exposición) |
| `/admin/tickets` | ADMIN |
| `/admin/usuarios` | ADMIN |
| `/admin/reportes` | ADMIN |
| `/admin/auditoria` | ADMIN |
| `/venta` | ADMIN o VENDEDOR |
| `/venta/tickets` | vendedor |
| `/perfil` | ambos |
| `/ticket/[codigo]` | público (URL impresa por el seed) |

---

## 6. Casos a probar (checklist)

### Login
- ADMIN → `/admin`
- VENDEDOR → `/venta`
- VENDEDOR no entra a `/admin*`

### POS (`/venta`)
- Horas abiertas / cerradas
- Varios animales e importes
- Total y `TicketPreview`

### PNG
1. Crear o abrir ticket del seed  
2. Descargar PNG  
3. Abrir imagen  

Debe verse: Lotería La Jungla, número, fecha, horas, animal+nombre, importes, TOTAL JUGADO, QR.  
No debe verse: 30×, premio, exposición, riesgo.

### QR
Escanear el PNG → `/ticket/[codigo]` del ticket correcto (`codigoPublico`, no `numeroVisible`).

### Resultados (`/admin`)
Fecha de prueba: resultado en una hora (animal 03); otra hora pendiente. Probar modificar resultado.

### Exposición
“Ver apuestas” en la hora con resultado: total, exposición, tickets afectados. El ticket **anulado** no participa.

### Liquidación (`/ticket/...`)
En el ticket multihora: línea GANADORA (03), NO_GANADORA (15), pendientes en la otra hora. Ticket anulado → ANULADO.

### Reportes / Auditoría
`/admin/reportes` y `/admin/auditoria`: CREAR_TICKET, ANULAR_TICKET, CREAR_VENDEDOR, CREAR_RESULTADO (sin passwords/tokens).

### Responsive / a11y
Escritorio y teléfono: `/venta`, `/ticket/[codigo]`. Labels, foco, botones disabled, contraste razonable.

---

## 7. PRUEBA DESDE MÓVIL

Solo para pruebas manuales en la misma Wi-Fi (red de confianza). No cambia autenticación, roles ni reglas de negocio.

1. PC y teléfono conectados a la **misma Wi-Fi** (no Wi-Fi público).
2. En el PC, desde `sorteo-lotto-activo`:

   ```bash
   npm run seed:manual-test
   npm run dev:test:lan
   ```

3. Copia la URL **LAN** que imprime el script (p. ej. `http://192.168.1.50:3000`).
4. Ábrela en el navegador del móvil.
5. Inicia sesión con el usuario de prueba (`manual_vendedor` o `manual_admin`).
6. Entra a `/venta`.
7. Crea un ticket.
8. Muestra el ticket en pantalla.
9. (Opcional) Descarga el PNG en el PC; el QR del preview/PNG debe seguir visible.
10. En el móvil (app abierta por la URL LAN), abre el ticket o el PNG generado ahí.
11. Escanea el QR (otra cámara / otra app).
12. Confirma que abre `/ticket/[codigoPublico]` en el **mismo origen** LAN.

**QR y origen:** el QR se arma con `window.location.origin`. Si entras por `http://192.168.1.50:3000`, el QR apunta a `http://192.168.1.50:3000/ticket/...` y **no** a `localhost`. No hay IP ni localhost hardcodeados en el preview.

Si el móvil no carga: revisa firewall (sección 3) y que ambos estén en la misma red privada.

---

## 8. Cómo limpiar datos de TEST

Solo sobre `TEST_DATABASE_URL` (nunca producción):

- Opción suave: re-ejecutar `npm run seed:manual-test` (idempotente).
- Opción fuerte (DB de test dedicada): borrar filas de tickets/resultados/auditoría del día, o recrear la DB de test.

No uses `prisma migrate reset` contra producción. No uses este seed como “limpieza” de prod.

---

## 9. Advertencia

```
NUNCA: seed:manual-test con TEST_DATABASE_URL = DATABASE_URL de producción
NUNCA: npm run dev apuntando a producción para “probar”
SIEMPRE: guard del script + URL de test aislada
```

El comando `npm test` **no** ejecuta este seed.
