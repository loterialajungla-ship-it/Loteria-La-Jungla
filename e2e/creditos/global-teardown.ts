import fs from "node:fs";
import {
  cleanupE2eFinancials,
  prepareE2eTestEnv,
  readE2eState,
  STATE_PATH,
} from "./harness";

async function globalTeardown() {
  prepareE2eTestEnv();
  if (!fs.existsSync(STATE_PATH)) {
    console.log("[e2e] teardown: sin estado; nada que limpiar");
    return;
  }
  const state = readE2eState();
  try {
    const cleaned = await cleanupE2eFinancials(state);
    console.log(
      `[e2e] cleanup financiero acotado: ${JSON.stringify(cleaned)} (usuarios/auditorías conservados)`,
    );
  } catch (e) {
    console.error(
      "[e2e] cleanup falló (usuarios/auditorías no se borran):",
      e instanceof Error ? e.message : e,
    );
  }
  // Conserva .run-state.json para el informe; no contiene secretos de DB.
  // La contraseña de prueba es conocida del harness (testpass12).
}

export default globalTeardown;
