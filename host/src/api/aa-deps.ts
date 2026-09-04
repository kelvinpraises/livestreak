import type { HostServerConfig } from "../config/host.js";
import { readAaServerConfig, buildPaymasterSigners, type AaServerConfig } from "../services/aa/chains.js";
import type { PaymasterSigner } from "../services/aa/paymaster.js";

// --- exports ---

export interface AaRouteDeps {
  readonly config: HostServerConfig;
  readonly aa: AaServerConfig;
  readonly paymasterSigners: Map<string, PaymasterSigner>;
}

export interface CreateAaRouteDepsOptions {
  readonly paymasterSigners?: Map<string, PaymasterSigner>;
}

export const createAaRouteDeps = (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {}
): AaRouteDeps => ({
  config,
  aa: readAaServerConfig(config),
  paymasterSigners: options.paymasterSigners ?? buildPaymasterSigners(readAaServerConfig(config))
});
