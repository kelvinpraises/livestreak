// TEMPORARY: the CLI should not write chain directly — packages own chain writes.
// Each of these migrates to its package and this file is then deleted:
//   goLive/setEnded -> @livestreak/observe   (gap: context/temp-convo/observe/inbox/from-cli__expose-setended.md)
//   createVault     -> @livestreak/bookmaker (gap: context/temp-convo/bookmaker/inbox/from-cli__expose-createvault.md)
//   mint            -> @livestreak/options   (gap: context/temp-convo/options/inbox/from-cli__expose-mint.md)

import { marketRegistryAbi } from "@livestreak/contracts/evm/abis";
import type { PointerScheme, StorePointer } from "@livestreak/host";
import type { EvmWalletInitConfig, WalletInit } from "@livestreak/schema";
import {
  createWalletManager,
  pollUntilUserOperationIncluded,
  type EvmErc4337WalletConfig,
  type WalletAccountEvmErc4337
} from "@livestreak/wallet";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type PublicClient
} from "viem";

// ── Wallet plumbing ──────────────────────────────────────────────────────────

export interface CreateCreatorWalletInput {
  readonly seed: string | Uint8Array;
  readonly config: EvmWalletInitConfig;
}

export interface CreatorWallet {
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly walletInit: WalletInit;
}

export const createCreatorWallet = async (
  input: CreateCreatorWalletInput
): Promise<CreatorWallet> => {
  const walletInit: WalletInit = {
    chain: "evm",
    seedSource: "signature-derived",
    config: input.config
  };

  const manager = createWalletManager(
    "evm",
    input.seed,
    input.config as EvmErc4337WalletConfig
  );
  const account = await manager.getAccount();
  const rpcUrl = input.config.provider;
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
    chain: {
      id: input.config.chainId,
      name: "livestreak",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    }
  });

  return { account, publicClient, walletInit };
};

// ── UserOperation polling + tx helpers ──────────────────────────────────────
// POLL: the local 2s poller is gone — chain writes use the shared, hex/number-safe
// `pollUntilUserOperationIncluded` from @livestreak/wallet (60s budget + backoff).

// sendContractCall / readUserOpTransactionHash removed (wave 5): the only writers that used the
// generic contract-call helper were the mint TEMP (now via the options bridge) and the ERC20 approve
// (now internal to options/bookmaker). goLive/setEnded use sendMarketCall directly.

// ensureErc20Approval removed (G4): options `fund`/`setLanes` and bookmaker `createVault` approve
// USDC internally now, so the CLI no longer pre-approves at the edge.

// ── goLive / setEnded (TEMP: migrates to @livestreak/observe) ───────────────

export const STORAGE_SCHEME = {
  WalrusTestnet: 0,
  WalrusMainnet: 1,
  Ipfs: 2,
  Arweave: 3
} as const;

export type StorageSchemeValue = (typeof STORAGE_SCHEME)[keyof typeof STORAGE_SCHEME];

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

export const STREAM_STATUS = {
  None: 0,
  Live: 1,
  Ended: 2
} as const;

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

// createVault migrated to @livestreak/bookmaker (createVaultOnce); see adapters/bookmaker.ts.

