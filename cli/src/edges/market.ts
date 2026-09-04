import { marketRegistryAbi } from "@livestreak/contracts/evm/abis";
import type { PointerScheme, StorePointer } from "@livestreak/host";
import type { WalletAccountEvmErc4337 } from "@livestreak/wallet";
import { encodeFunctionData, type PublicClient } from "viem";

export const STORAGE_SCHEME = {
  WalrusTestnet: 0,
  WalrusMainnet: 1,
  Ipfs: 2,
  Arweave: 3
} as const;

export type StorageSchemeValue = (typeof STORAGE_SCHEME)[keyof typeof STORAGE_SCHEME];

export const STREAM_STATUS = {
  None: 0,
  Live: 1,
  Ended: 2
} as const;

export interface OnChainStreamState {
  readonly status: number;
  readonly scheme: number;
  readonly id: string;
  readonly updatedAt: bigint;
  readonly endedAt: bigint;
}

export interface PublishVodInput {
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly marketRegistryAddress: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly pointer: StorePointer;
}

export interface PublishVodResult {
  readonly goLiveTx: string;
  readonly setEndedTx: string;
  readonly streamState: OnChainStreamState;
}

export const pointerSchemeToStorageScheme = (scheme: PointerScheme): StorageSchemeValue => {
  switch (scheme) {
    case "walrus-testnet":
      return STORAGE_SCHEME.WalrusTestnet;
    case "walrus-mainnet":
      return STORAGE_SCHEME.WalrusMainnet;
    case "ipfs":
      return STORAGE_SCHEME.Ipfs;
    case "arweave":
      return STORAGE_SCHEME.Arweave;
  }
};

export const validateStorageId = (id: string): void => {
  if (id.length === 0 || id.length > 64) {
    throw new Error(`Storage id length must be 1..64 bytes, got ${id.length}`);
  }
};

const pollUntilUserOperationIncluded = async (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await readOnly.getUserOperationReceipt(userOpHash);
    if (receipt !== null && receipt !== undefined) {
      assertUserOperationSucceeded(receipt);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for UserOperation receipt for ${userOpHash}`);
};

const assertUserOperationSucceeded = (receipt: unknown): void => {
  if (typeof receipt !== "object" || receipt === null) {
    throw new Error("UserOperation receipt payload is not an object");
  }

  const success = (receipt as Record<string, unknown>)["success"];
  if (typeof success !== "boolean") {
    throw new Error("UserOperation receipt is missing success");
  }

  if (success === false) {
    throw new Error("UserOperation included but reverted");
  }
};

const sendMarketCall = async (
  account: WalletAccountEvmErc4337,
  marketRegistryAddress: `0x${string}`,
  functionName: "goLive" | "setEnded",
  args: readonly [`0x${string}`, number, string]
): Promise<string> => {
  const data = encodeFunctionData({
    abi: marketRegistryAbi,
    functionName,
    args: [...args]
  });

  const sendResult = await account.sendTransaction({
    to: marketRegistryAddress,
    data,
    value: 0n
  });

  const readOnly = await account.toReadOnlyAccount();
  await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
  return sendResult.hash;
};

export const readStreamState = async (
  publicClient: PublicClient,
  marketRegistryAddress: `0x${string}`,
  marketId: `0x${string}`
): Promise<OnChainStreamState> => {
  const result = await publicClient.readContract({
    address: marketRegistryAddress,
    abi: marketRegistryAbi,
    functionName: "streamState",
    args: [marketId]
  });

  const [status, scheme, id, updatedAt, endedAt] = result as [
    number,
    number,
    string,
    bigint,
    bigint
  ];

  return { status, scheme, id, updatedAt, endedAt };
};

export const publishVod = async (input: PublishVodInput): Promise<PublishVodResult> => {
  const scheme = pointerSchemeToStorageScheme(input.pointer.scheme);
  validateStorageId(input.pointer.id);

  const args = [input.marketId, scheme, input.pointer.id] as const;

  const goLiveTx = await sendMarketCall(
    input.account,
    input.marketRegistryAddress,
    "goLive",
    args
  );

  const setEndedTx = await sendMarketCall(
    input.account,
    input.marketRegistryAddress,
    "setEnded",
    args
  );

  const streamState = await readStreamState(
    input.publicClient,
    input.marketRegistryAddress,
    input.marketId
  );

  if (streamState.status !== STREAM_STATUS.Ended) {
    throw new Error(`Expected streamState.status Ended (2), got ${streamState.status}`);
  }

  if (streamState.id !== input.pointer.id) {
    throw new Error(`streamState.id mismatch: on-chain ${streamState.id}, pointer ${input.pointer.id}`);
  }

  return { goLiveTx, setEndedTx, streamState };
};

/** Enforces goLive-before-setEnded ordering at the edge (for negative-path tests). */
export const encodeSetEndedOnly = (
  marketId: `0x${string}`,
  scheme: StorageSchemeValue,
  id: string
): `0x${string}` =>
  encodeFunctionData({
    abi: marketRegistryAbi,
    functionName: "setEnded",
    args: [marketId, scheme, id]
  });

export const encodeGoLive = (
  marketId: `0x${string}`,
  scheme: StorageSchemeValue,
  id: string
): `0x${string}` =>
  encodeFunctionData({
    abi: marketRegistryAbi,
    functionName: "goLive",
    args: [marketId, scheme, id]
  });
