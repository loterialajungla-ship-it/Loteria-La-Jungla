# Pruebas HTTP pendientes — GET /api/admin/exposicion

Cubierto: agregación pura en `aggregate-exposure.test.ts`.

Pendiente con cookie admin + DB:

1. Sin sesión → **401**
2. fecha inválida → **400**
3. hora inválida / fuera de HORAS_SORTEO → **400**
4. consulta correcta → **200** con strings money
5. tickets ANULADO no aparecen
6. horas/fechas distintas no se mezclan (vía datos reales)
