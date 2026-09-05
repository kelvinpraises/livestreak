// TEMPORARY: the CLI should not write chain directly — packages own chain writes.
// Each of these migrates to its package and this file is then deleted:
//   goLive/setEnded -> @livestreak/observe   (gap: context/temp-convo/observe/inbox/from-cli__expose-setended.md)
//   createVault     -> @livestreak/bookmaker (gap: context/temp-convo/bookmaker/inbox/from-cli__expose-createvault.md)
//   mint            -> @livestreak/options   (gap: context/temp-convo/options/inbox/from-cli__expose-mint.md)

import {
  marketDriverAbi,
  marketRegistryAbi
} from "@livestreak/contracts/evm/abis";
import type { PointerScheme, StorePointer } from "@livestreak/host";
import {
  asMarketId,
  asTokenId,
  asUserAddress,
  type MarketId,
  type TokenId
} from "@livestreak/options";
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
  erc20Abi,
  http,
  parseEventLogs,
  type Abi,
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

export const readUserOpTransactionHash = (receipt: unknown): `0x${string}` => {
  if (typeof receipt !== "object" || receipt === null) {
    throw new Error("UserOperation receipt payload is not an object");
  }

  const record = receipt as Record<string, unknown>;
  const nested = record["receipt"];
  const direct = record["transactionHash"];

  if (typeof direct === "string" && direct.startsWith("0x")) {
    return direct as `0x${string}`;
  }

  if (typeof nested === "object" && nested !== null) {
    const txHash = (nested as Record<string, unknown>)["transactionHash"];
    if (typeof txHash === "string" && txHash.startsWith("0x")) {
      return txHash as `0x${string}`;
    }
  }

  throw new Error("UserOperation receipt is missing transactionHash");
};

export const sendContractCall = async (
  account: WalletAccountEvmErc4337,
  to: `0x${string}`,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = []
): Promise<{ readonly userOpHash: string; readonly userOpReceipt: unknown }> => {
  const data = encodeFunctionData({
    abi,
    functionName,
    args: args as readonly unknown[] | undefined
  });

  const sendResult = await account.sendTransaction({
    to,
    data,
    value: 0n
  });

  const readOnly = await account.toReadOnlyAccount();
  const userOpReceipt = await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
  return { userOpHash: sendResult.hash, userOpReceipt };
};

export const ensureErc20Approval = async (
  account: WalletAccountEvmErc4337,
  publicClient: PublicClient,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<string | undefined> => {
  const owner = (await account.getAddress()) as `0x${string}`;
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender]
  });

  if (allowance >= amount) {
    return undefined;
  }

  const { userOpHash } = await sendContractCall(account, token, erc20Abi, "approve", [
    spender,
    amount
  ]);

  return userOpHash;
};

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

// ── mint (TEMP: migrates to @livestreak/options) ─────────────────────────────

export interface OperatorMintNftInput {
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly marketDriverAddress: `0x${string}`;
  readonly marketId: MarketId;
  readonly to?: `0x${string}`;
  readonly salt?: string;
}

export interface OperatorMintNftResult {
  readonly tokenId: TokenId;
  readonly tx: string;
}

export const parseMintSalt = (value: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("salt must be a non-negative integer string");
  }

  if (parsed < 0n) {
    throw new Error("salt must be >= 0");
  }

  const maxUint64 = 18446744073709551615n;
  if (parsed > maxUint64) {
    throw new Error("salt must fit uint64");
  }

  return parsed;
};

export const encodeMintCall = (marketId: MarketId, to: `0x${string}`): `0x${string}` =>
  encodeFunctionData({
    abi: marketDriverAbi,
    functionName: "mint",
    args: [marketId as `0x${string}`, to]
  });

export const encodeMintWithSaltCall = (
  marketId: MarketId,
  salt: bigint,
  to: `0x${string}`
): `0x${string}` =>
  encodeFunctionData({
    abi: marketDriverAbi,
    functionName: "mintWithSalt",
    args: [marketId as `0x${string}`, salt, to]
  });

export const parseMarketNftMintedTokenId = (
  logs: readonly unknown[],
  marketDriverAddress: `0x${string}`
): bigint => {
  const events = parseEventLogs({
    abi: marketDriverAbi,
    logs: logs as never,
    eventName: "MarketNftMinted"
  }).filter((event) => event.address.toLowerCase() === marketDriverAddress.toLowerCase());

  if (events.length === 0) {
    throw new Error("MarketNftMinted event not found in transaction receipt");
  }

  const tokenId = events[0]?.args.tokenId;
  if (typeof tokenId !== "bigint") {
    throw new Error("MarketNftMinted event is missing tokenId");
  }

  return tokenId;
};

export const operatorMintNft = async (
  input: OperatorMintNftInput
): Promise<OperatorMintNftResult> => {
  const to = asUserAddress((input.to ?? (await input.account.getAddress())) as `0x${string}`);
  const marketId = asMarketId(input.marketId);

  if (input.salt !== undefined) {
    const salt = parseMintSalt(input.salt);
    const minter = (await input.account.getAddress()) as `0x${string}`;

    const expectedTokenId = await input.publicClient.readContract({
      address: input.marketDriverAddress,
      abi: marketDriverAbi,
      functionName: "calcTokenIdWithSalt",
      args: [minter, salt]
    });

    const { userOpHash, userOpReceipt } = await sendContractCall(
      input.account,
      input.marketDriverAddress,
      marketDriverAbi,
      "mintWithSalt",
      [marketId, salt, to]
    );

    const txHash = readUserOpTransactionHash(userOpReceipt);
    const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
    const tokenId = parseMarketNftMintedTokenId(receipt.logs, input.marketDriverAddress);

    if (tokenId !== expectedTokenId) {
      throw new Error(
        `mintWithSalt tokenId mismatch: event ${tokenId.toString()} vs calc ${expectedTokenId.toString()}`
      );
    }

    return { tokenId: asTokenId(tokenId), tx: userOpHash };
  }

  const { userOpHash, userOpReceipt } = await sendContractCall(
    input.account,
    input.marketDriverAddress,
    marketDriverAbi,
    "mint",
    [marketId, to]
  );

  const txHash = readUserOpTransactionHash(userOpReceipt);
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
  const tokenId = parseMarketNftMintedTokenId(receipt.logs, input.marketDriverAddress);

  return { tokenId: asTokenId(tokenId), tx: userOpHash };
};
