/**
 * Auditoría administrativa.
 *
 * LOGIN / LOGOUT: best-effort fuera de la TX de sesión.
 * Si falla el insert de Auditoria tras login/logout exitoso, se registra
 * en consola y no se revierte la sesión (no hay TX de negocio que
 * deshacer). No se guardan IP, user-agent, token ni password.
 *
 * Acciones de negocio (tickets, usuarios, resultados, passwords):
 * atómicas con la operación vía recordAuditEvent en la misma $transaction.
 *
 * Retención: sin borrado automático en v1.
 */
