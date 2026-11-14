/**
 * Preloaded by `npm test`: fails any test that reaches for the real network, so the offline suite can never
 * send traffic to hackjunction.app. Tests inject a fake fetch instead (see fake-platform.ts).
 */
globalThis.fetch = async (input) => {
  throw new Error(`Offline tests must not touch the network (tried ${String(input instanceof Request ? input.url : input)})`);
};
