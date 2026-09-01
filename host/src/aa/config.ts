import type { AaOperationKind, AaSponsorshipMode } from "@livestreak/host";
import type { Hex } from "viem";
import type { HostServerConfig } from "../descriptor/config.js";
import { startAlto } from "./alto.js";
import { createPaymasterSigner, type PaymasterSigner } from "./paymaster-signer.js";

// --- exports ---

export interface AaChainConfig {
  readonly routeKey: string;
  readonly chainId: number;
  readonly name: string;
  readonly entryPoint: string;
  readonly safeModule?: string;
  readonly bundlerUrl?: string;
  readonly rpcUrl?: string;
  readonly executorPrivateKey?: Hex;
  readonly paymasterAddress?: Hex;
}

export interface AaServerConfig {
  readonly sponsorshipMode: AaSponsorshipMode;
  readonly supportedOperations: readonly AaOperationKind[];
  readonly paymasterPath: string;
  readonly chains: readonly AaChainConfig[];
}

export const readAaServerConfig = (_config: HostServerConfig): AaServerConfig => {
  const executorPrivateKey = readExecutorPrivateKey();
  const paymasterAddress = readPaymasterAddress();

  return {
    sponsorshipMode: "dev_open",
    supportedOperations: ["user_operation", "safe_module_call"],
    paymasterPath: "/aa/paymaster",
    chains: [
      {
        routeKey: "local",
        chainId: Number.parseInt(process.env.LIVESTREAK_AA_CHAIN_ID ?? "31337", 10),
        name: "local",
        entryPoint:
          process.env.LIVESTREAK_AA_ENTRY_POINT ??
          "0x0000000000000000000000000000000000000000",
        safeModule: process.env.LIVESTREAK_AA_SAFE_MODULE,
        bundlerUrl: process.env.LIVESTREAK_AA_BUNDLER_URL,
        rpcUrl: process.env.LIVESTREAK_AA_RPC_URL,
        ...(executorPrivateKey === undefined ? {} : { executorPrivateKey }),
        ...(paymasterAddress === undefined ? {} : { paymasterAddress })
      }
    ]
  };
};

export const resolveAaChain = (
  aa: AaServerConfig,
  routeKey: string
): AaChainConfig | undefined => aa.chains.find((chain) => chain.routeKey === routeKey);

export const buildPaymasterSigners = (aa: AaServerConfig): Map<string, PaymasterSigner> => {
  const signers = new Map<string, PaymasterSigner>();

  for (const chain of aa.chains) {
    if (chain.executorPrivateKey === undefined || chain.paymasterAddress === undefined) {
      continue;
    }

    signers.set(
      chain.routeKey,
      createPaymasterSigner(chain.executorPrivateKey, chain.paymasterAddress)
    );
  }

  return signers;
};

export const bootstrapAaFromConfig = async (aa: AaServerConfig): Promise<void> => {
  for (const chain of aa.chains) {
    if (
      chain.rpcUrl === undefined ||
      chain.entryPoint === undefined ||
      chain.executorPrivateKey === undefined
    ) {
      continue;
    }

    await startAlto(chain.routeKey, {
      entryPointAddress: chain.entryPoint,
      rpcUrl: chain.rpcUrl,
      executorPrivateKey: chain.executorPrivateKey,
      port: 0
    });
  }
};

// --- helpers ---

const readExecutorPrivateKey = (): Hex | undefined => {
  const value =
    process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY ?? process.env.LIVESTREAK_AA_OPERATOR_KEY;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};

const readPaymasterAddress = (): Hex | undefined => {
  const value = process.env.LIVESTREAK_AA_PAYMASTER_ADDRESS;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};
