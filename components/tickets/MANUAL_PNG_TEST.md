# Prueba manual — imagen PNG del ticket

1. Inicia sesión admin (`/login`) y abre `/venta`.
2. Selecciona horas, agrega animales/importes y pulsa **Crear ticket**.
3. Verifica `TicketPreview` (marca, número, fecha, líneas, total, QR).
4. Pulsa **Descargar imagen** → abre el PNG.
5. Comprueba texto legible y QR visible en la imagen.
6. Escanea el QR → debe abrir `/ticket/{codigoPublico}`.
7. En móvil, pulsa **Compartir** → selector del sistema (WhatsApp, etc.).
8. En escritorio sin Web Share de archivos: **Compartir** descarga el PNG.

## Pendiente automatizar

- Web Share API / captura real en navegador (no hay e2e en el proyecto).
