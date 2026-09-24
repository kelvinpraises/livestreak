import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AaChainConfig } from "../../services/aa/chains.js";

// --- exports ---

const VERIFYING_PAYMASTER_ABI = [
  {
    type: "function",
    name: "verifyingSigner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  }
] as const;

export const assertPaymasterSignerMatchesChain = async (
  chain: AaChainConfig
): Promise<void> => {
  if (
    chain.executorPrivateKey === undefined ||
    chain.paymasterAddress === undefined ||
    chain.rpcUrl === undefined
  ) {
    return;
  }

  const signerAddress = privateKeyToAccount(chain.executorPrivateKey).address;
  const client = createPublicClient({
    transport: http(chain.rpcUrl)
  });

  // Boot race: the local chain's RPC can still be coming up when the host starts (dev.sh boots
  // both). A transport failure here is retried with backoff; a real signer MISMATCH still exits.
  const onChainSigner = (await readWithBootRetry(() =>
    client.readContract({
      address: chain.paymasterAddress as Address,
      abi: VERIFYING_PAYMASTER_ABI,
      functionName: "verifyingSigner"
    })
  )) as Address;

  if (onChainSigner.toLowerCase() !== signerAddress.toLowerCase()) {
    console.error(
      `[aa]: paymaster signer mismatch for ${chain.routeKey}: executor ${signerAddress} != on-chain ${onChainSigner}`
    );
    process.exit(1);
  }
};

const readWithBootRetry = async <T>(read: () => Promise<T>): Promise<T> => {
  // ~60s total: a cold dev.sh boot rebuilds every workspace while anvil warms up, and the
  // 15s ladder this started with was measured too tight under that load (2026-07-22).
  const delaysMs = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000];
  for (const delayMs of delaysMs) {
    try {
      return await read();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes("HTTP request failed")) {
        throw cause; // a real contract error — surface it, never mask it
      }
      console.warn(`[aa]: chain RPC not ready yet, retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return read();
};

export const readExecutorAddress = (executorPrivateKey: Hex): Address =>
  privateKeyToAccount(executorPrivateKey).address;
