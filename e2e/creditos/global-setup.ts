import {
  bootstrapE2eUsers,
  prepareE2eTestEnv,
} from "./harness";

async function globalSetup() {
  const { endpointId } = prepareE2eTestEnv();
  console.log(`[e2e] globalSetup TEST endpoint=${endpointId}`);
  const state = await bootstrapE2eUsers();
  console.log(
    `[e2e] usuarios creados runId=${state.runId} (prefijo fase53_e2e_)`,
  );
}

export default globalSetup;
