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

  const onChainSigner = (await client.readContract({
    address: chain.paymasterAddress as Address,
    abi: VERIFYING_PAYMASTER_ABI,
    functionName: "verifyingSigner"
  })) as Address;

  if (onChainSigner.toLowerCase() !== signerAddress.toLowerCase()) {
    console.error(
      `[aa]: paymaster signer mismatch for ${chain.routeKey}: executor ${signerAddress} != on-chain ${onChainSigner}`
    );
    process.exit(1);
  }
};

export const readExecutorAddress = (executorPrivateKey: Hex): Address =>
  privateKeyToAccount(executorPrivateKey).address;
