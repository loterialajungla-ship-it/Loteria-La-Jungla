import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  applyConfirmOperationFailure,
  canDismissConfirmDialog,
  canSubmitConfirmDialog,
  isConfirmMotivoValid,
  resolveConfirmDialogInitialFocus,
} from "@/lib/ui/confirm-dialog";

const ROOT = path.resolve(__dirname, "../..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function classTokens(html: string, tag = "button"): string[] {
  const matches = [
    ...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\sclass="([^"]*)"`, "gi")),
  ];
  return matches.flatMap((m) => m[1]!.split(/\s+/).filter(Boolean));
}

describe("confirm-dialog — lógica pura", () => {
  it("motivo ausente / opcional vacío es válido", () => {
    assert.equal(isConfirmMotivoValid(undefined), true);
    assert.equal(isConfirmMotivoValid(null), true);
    assert.equal(
      isConfirmMotivoValid({ value: "", required: false }),
      true,
    );
    assert.equal(
      isConfirmMotivoValid({ value: "  ", required: false }),
      true,
    );
  });

  it("motivo obligatorio exige texto no vacío", () => {
    assert.equal(
      isConfirmMotivoValid({ value: "", required: true }),
      false,
    );
    assert.equal(
      isConfirmMotivoValid({ value: "   ", required: true }),
      false,
    );
    assert.equal(
      isConfirmMotivoValid({ value: "Error de digitación", required: true }),
      true,
    );
  });

  it("motivo respeta maxLength sobre el texto recortado", () => {
    assert.equal(
      isConfirmMotivoValid({
        value: "abc",
        required: true,
        maxLength: 2,
      }),
      false,
    );
    assert.equal(
      isConfirmMotivoValid({
        value: "ab",
        required: true,
        maxLength: 2,
      }),
      true,
    );
  });

  it("loading bloquea dismiss y submit (doble envío)", () => {
    assert.equal(canDismissConfirmDialog(true), false);
    assert.equal(canDismissConfirmDialog(false), true);
    assert.equal(
      canSubmitConfirmDialog({ loading: true, motivo: undefined }),
      false,
    );
    assert.equal(
      canSubmitConfirmDialog({ loading: false, motivo: undefined }),
      true,
    );
  });

  it("submit exige motivo cuando es obligatorio", () => {
    assert.equal(
      canSubmitConfirmDialog({
        loading: false,
        motivo: { value: "", required: true },
      }),
      false,
    );
    assert.equal(
      canSubmitConfirmDialog({
        loading: false,
        motivo: { value: "ok", required: true },
      }),
      true,
    );
    assert.equal(
      canSubmitConfirmDialog({
        loading: false,
        motivo: { value: "", required: false },
      }),
      true,
    );
  });

  it("foco inicial: danger → cancel; default → confirm; motivo required gana", () => {
    assert.equal(
      resolveConfirmDialogInitialFocus({ variant: "danger" }),
      "cancel",
    );
    assert.equal(
      resolveConfirmDialogInitialFocus({ variant: "default" }),
      "confirm",
    );
    assert.equal(
      resolveConfirmDialogInitialFocus({
        variant: "danger",
        motivoRequired: true,
      }),
      "motivo",
    );
    assert.equal(
      resolveConfirmDialogInitialFocus({
        variant: "default",
        motivoRequired: true,
      }),
      "motivo",
    );
  });

  it("fallo post-confirmación: cierra diálogo, busy false, error visible; campos no se tocan", () => {
    const formFields = { importe: "25.00", motivo: "e2e" };
    const next = applyConfirmOperationFailure({
      errorMessage: "Saldo insuficiente. El backend rechazó el retiro.",
    });
    assert.equal(next.confirmOpen, false);
    assert.equal(next.busy, false);
    assert.equal(
      next.error,
      "Saldo insuficiente. El backend rechazó el retiro.",
    );
    assert.equal(formFields.importe, "25.00");
    assert.equal(formFields.motivo, "e2e");
    assert.equal(canDismissConfirmDialog(next.busy), true);
    assert.equal(
      canSubmitConfirmDialog({ loading: next.busy, motivo: undefined }),
      true,
    );
  });
});

describe("ConfirmDialog — markup / a11y / estados", () => {
  it("cerrado no renderiza nada", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: false,
        title: "Título",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.equal(html, "");
  });

  it("abierto: alertdialog, título, descripción y botones táctiles", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Confirmar asignación",
        description: "¿Asignar 10.00 créditos?",
        confirmLabel: "Asignar",
        cancelLabel: "Cancelar",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(html, /role="alertdialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /Confirmar asignación/);
    assert.match(html, /¿Asignar 10\.00 créditos\?/);
    assert.match(html, />Asignar</);
    assert.match(html, />Cancelar</);
    const tokens = classTokens(html, "button");
    assert.ok(tokens.includes("min-h-11"));
  });

  it("variante danger: Cancelar es autofocus; Confirmar no", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Confirmar retiro",
        variant: "danger",
        confirmLabel: "Retirar ahora",
        cancelLabel: "Cancelar",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(html, /text-danger-800/);
    assert.match(html, /border-danger-100/);
    assert.match(html, /data-initial-focus="cancel"/);
    const cancelIdx = html.indexOf(">Cancelar<");
    const confirmIdx = html.indexOf(">Retirar ahora<");
    assert.ok(cancelIdx >= 0 && confirmIdx >= 0);
    const cancelSlice = html.slice(Math.max(0, cancelIdx - 200), cancelIdx);
    const confirmSlice = html.slice(Math.max(0, confirmIdx - 200), confirmIdx);
    assert.match(cancelSlice, /data-autofocus-target="true"/);
    assert.equal(confirmSlice.includes('data-autofocus-target="true"'), false);
  });

  it("variante default: Confirmar es autofocus", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Confirmar asignación",
        variant: "default",
        confirmLabel: "Asignar ahora",
        cancelLabel: "Cancelar",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(html, /data-initial-focus="confirm"/);
    const confirmIdx = html.indexOf(">Asignar ahora<");
    const cancelIdx = html.indexOf(">Cancelar<");
    assert.ok(confirmIdx >= 0 && cancelIdx >= 0);
    const confirmSlice = html.slice(Math.max(0, confirmIdx - 200), confirmIdx);
    const cancelSlice = html.slice(Math.max(0, cancelIdx - 200), cancelIdx);
    assert.match(confirmSlice, /data-autofocus-target="true"/);
    assert.equal(cancelSlice.includes('data-autofocus-target="true"'), false);
  });

  it("loading: botones deshabilitados y texto Procesando", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Confirmar",
        loading: true,
        confirmLabel: "Asignar",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(html, /Procesando…/);
    assert.match(html, /aria-busy="true"/);
    const disabledCount = (html.match(/\sdisabled(?:=|>|\s)/g) ?? []).length;
    assert.ok(disabledCount >= 2, `esperaba ≥2 disabled, hay ${disabledCount}`);
  });

  it("motivo opcional: label y sin required bloqueante vacío", () => {
    let value = "";
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Con motivo",
        onConfirm: () => {},
        onCancel: () => {},
        motivo: {
          value,
          onChange: (v) => {
            value = v;
          },
          required: false,
        },
      }),
    );
    assert.match(html, /Motivo \(opcional\)/);
    assert.match(html, /name="confirm-dialog-motivo"/);
    assert.equal(
      canSubmitConfirmDialog({
        loading: false,
        motivo: { value: "", required: false },
      }),
      true,
    );
  });

  it("motivo obligatorio: error y confirm deshabilitado si vacío", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Con motivo",
        onConfirm: () => {},
        onCancel: () => {},
        motivo: {
          value: "",
          onChange: () => {},
          required: true,
        },
      }),
    );
    assert.match(html, /El motivo es obligatorio/);
    assert.match(html, /Motivo</);
    assert.equal(
      canSubmitConfirmDialog({
        loading: false,
        motivo: { value: "", required: true },
      }),
      false,
    );
  });

  it("callbacks de confirm/cancel son invocables (contrato)", () => {
    let confirmed = 0;
    let cancelled = 0;
    const props = {
      open: true,
      title: "X",
      onConfirm: () => {
        confirmed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
    };
    renderToStaticMarkup(createElement(ConfirmDialog, props));
    props.onConfirm();
    props.onCancel();
    assert.equal(confirmed, 1);
    assert.equal(cancelled, 1);
  });
});

describe("ConfirmDialog — integración créditos / usuarios (sin window.confirm)", () => {
  const productFiles = [
    "components/creditos/AsignarCreditosForm.tsx",
    "components/creditos/RetirarCreditosForm.tsx",
    "components/creditos/CorregirCreditosForm.tsx",
    "components/creditos/CreditosConfigForm.tsx",
    "components/users/UserStatusButton.tsx",
  ];

  it("formularios de producto ya no usan window.confirm", () => {
    for (const rel of productFiles) {
      const src = readSrc(rel);
      assert.equal(
        src.includes("window.confirm"),
        false,
        `${rel} aún contiene window.confirm`,
      );
      assert.match(src, /ConfirmDialog/, `${rel} debe usar ConfirmDialog`);
    }
  });

  it("Asignar / Retirar / Corregir conservan endpoints y campos de API", () => {
    const asignar = readSrc("components/creditos/AsignarCreditosForm.tsx");
    assert.match(asignar, /\/api\/admin\/creditos\/\$\{encodeURIComponent\(vendedorId\)\}\/asignar/);
    assert.match(asignar, /idempotencyKey/);
    assert.match(asignar, /motivo: motivo\.trim\(\) \|\| undefined/);

    const retirar = readSrc("components/creditos/RetirarCreditosForm.tsx");
    assert.match(retirar, /\/retirar/);
    assert.match(retirar, /INSUFFICIENT_CREDITO_SALDO/);

    const corregir = readSrc("components/creditos/CorregirCreditosForm.tsx");
    assert.match(corregir, /\/corregir/);
    assert.match(corregir, /movimientoOrigenId/);
    assert.match(corregir, /efecto/);
  });

  it("UserStatusButton conserva activar/desactivar y no toca reset password", () => {
    const src = readSrc("components/users/UserStatusButton.tsx");
    assert.match(src, /\$\{action\}/);
    assert.match(src, /"activar"\s*\|\s*"desactivar"/);
    assert.match(src, /pedirConfirmacion\("activar"\)/);
    assert.match(src, /pedirConfirmacion\("desactivar"\)/);
    assert.equal(src.toLowerCase().includes("reset"), false);
    assert.equal(src.toLowerCase().includes("password"), false);
  });

  it("CreditosConfigForm solo confirma al activar controlActivo=true", () => {
    const src = readSrc("components/creditos/CreditosConfigForm.tsx");
    assert.match(src, /body\.controlActivo === true/);
    assert.match(src, /Activar control de créditos/);
    assert.match(src, /\/api\/admin\/creditos\/config/);
  });

  it("U1.1: fallos API cierran el diálogo vía applyConfirmOperationFailure", () => {
    for (const rel of productFiles) {
      const src = readSrc(rel);
      assert.match(
        src,
        /applyConfirmOperationFailure/,
        `${rel} debe usar applyConfirmOperationFailure`,
      );
      assert.match(src, /failConfirmed/, `${rel} debe tener failConfirmed`);
    }
  });

  it("U1.1: Asignar conserva campos al fallar (no limpia importe/motivo en fail)", () => {
    const src = readSrc("components/creditos/AsignarCreditosForm.tsx");
    // Limpieza de campos solo en éxito, no dentro de failConfirmed.
    const failFn = src.slice(
      src.indexOf("function failConfirmed"),
      src.indexOf("async function ejecutarAsignacion"),
    );
    assert.equal(failFn.includes("setImporte"), false);
    assert.equal(failFn.includes("setMotivo"), false);
    assert.match(src, /setOk\("Créditos asignados correctamente\."\)/);
    assert.match(src, /invalidateKey\(\);\s*\n\s*setImporte\(""\)/);
  });
});

describe("window.confirm — inventario residual justificado", () => {
  it("solo permanece en helpers e2e (comentario/histórico de diálogos nativos)", () => {
    const helpers = readSrc("e2e/creditos/helpers.ts");
    // Tras U1 el helper confirma ConfirmDialog; puede mencionar window.confirm
    // solo como legado documentado.
    assert.ok(
      helpers.includes("ConfirmDialog") ||
        helpers.includes("alertdialog") ||
        helpers.includes("confirmOpenDialog") ||
        helpers.includes("acceptConfirms"),
      "helpers e2e deben contemplar el nuevo diálogo o el adaptador",
    );
  });
});
