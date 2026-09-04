import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { asMarketId, asTokenId, asUserAddress, type MarketId, type TokenId } from "@livestreak/options";
import type { WalletAccountEvmErc4337 } from "@livestreak/wallet";
import { encodeFunctionData, parseEventLogs, type PublicClient } from "viem";
import { readUserOpTransactionHash, sendContractCall } from "../chains/evm-tx.js";

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
