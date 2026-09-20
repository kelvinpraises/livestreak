// Browser-safe Solana barrel (BROWSER.md rules): IDL + seeds + committed deployment +
// the engine-wasm reader. Disk loaders and deploy tooling live behind ./node.
export const chain = "solana" as const;

export * from "./types.js";
export * from "./seeds.js";
export { livestreakIdl, type Livestreak, type LivestreakIdl } from "./idl/index.js";
export { addresses, deployment } from "./addresses-static.js";
export { localnetDeployment } from "./deployments/localnet.js";
export {
  EngineView,
  decodeProtocolState,
  decodeProtocolBlob,
  type EngineBoard,
  type EngineVault,
  type EnginePosition,
  type EngineBoundary,
  type EngineSummary,
} from "./engine-wasm.js";
