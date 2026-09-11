// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build PTBs + read VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import {
  Transaction,
  SuiJsonRpcClient,
  bcs,
  createSuiReadClient,
  createWalletManager,
  type SuiWalletConfig
} from "@livestreak/wallet";
import { MODULES, target } from "@livestreak/contracts/sui";

import type {
  BookmakerChainConfig,
  BookmakerChainWriter,
  CreateVaultInput,
  CreateVaultResult,
  TxId,
  VaultId
} from "../types.js";
import { asTxId, asVaultId } from "../types.js";
import type { BookmakerSuiObjectIds } from "../addresses.js";

const SUI_CLOCK_OBJECT_ID = "0x6";
const SUI_BYTES32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

// yes/no -> Move seed_side u8 (SIDE_YES = 0, SIDE_NO = 1).
const sideToSui = (side: "yes" | "no"): number => (side === "yes" ? 0 : 1);

const bytes32ByteArray = (id: string, field = "marketId"): number[] => {
  if (!SUI_BYTES32_RE.test(id)) {
    throw new LiveStreakConfigError({
      message: `Bookmaker Sui write requires a bytes32 ${field}`,
      metadata: { details: id }
    });
  }
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

const vecU8Arg = (bytes: number[]): Uint8Array => bcs.vector(bcs.u8()).serialize(bytes).toBytes();

const vaultIdFromBytes = (bytes: readonly number[]): VaultId =>
  asVaultId(`0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`);

const parseVaultCreated = (
  events: ReadonlyArray<{ type: string; parsedJson?: unknown }> | null | undefined
): VaultId | undefined => {
  const event = events?.find((e) => e.type.endsWith("::vault_driver::VaultCreated"));
  const parsed = event?.parsedJson as { vault_id?: number[] } | undefined;
  return parsed?.vault_id === undefined ? undefined : vaultIdFromBytes(parsed.vault_id);
};

export const createSuiBookmakerWriter = (config: BookmakerChainConfig): BookmakerChainWriter => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({
      message: "Sui bookmaker writer requires walletInit.chain === sui"
    });
  }

  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const ids = config.addresses as BookmakerSuiObjectIds;
  const packageId = ids.packageId;
  const coinType = `${packageId}::mock_usdc::MOCK_USDC`;

  // Derive the account/owner/client ONCE per writer and reuse across send + coin discovery.
  type SuiContext = {
    account: { sendTransaction(tx: Transaction): Promise<{ hash: string }>; getAddress(): Promise<string> };
    owner: string;
    client: SuiJsonRpcClient;
  };
  let suiPromise: Promise<SuiContext> | undefined;
  const getSui = (): Promise<SuiContext> => {
    if (suiPromise === undefined) {
      suiPromise = (async () => {
        const manager = createWalletManager("sui", config.seed, suiConfig);
        const account = (await manager.getAccount()) as SuiContext["account"];
        const owner = await account.getAddress();
        const rpcUrl = Array.isArray(suiConfig.rpcUrl) ? suiConfig.rpcUrl[0] : (suiConfig.rpcUrl ?? "");
        const client = createSuiReadClient(rpcUrl as string);
        return { account, owner, client };
      })();
    }
    return suiPromise;
  };

  const findUsdcCoins = async (amount: bigint): Promise<string[]> => {
    const { owner, client } = await getSui();
    const coins = await client.getCoins({ owner, coinType });
    let total = 0n;
    const objectIds: string[] = [];
    for (const coin of coins.data) {
      objectIds.push(coin.coinObjectId);
      total += BigInt(coin.balance);
      if (total >= amount) break;
    }
    if (total < amount) {
      throw new LiveStreakConfigError({
        message: `Sui: insufficient ${coinType} balance for createVault`,
        metadata: { details: `need ${amount}, have ${total}` }
      });
    }
    return objectIds;
  };

  return {
    createVault: async (input: CreateVaultInput): Promise<CreateVaultResult> => {
      const marketBytes = bytes32ByteArray(input.marketId, "marketId");
      const questionBytes = Array.from(new TextEncoder().encode(input.question));
      const side = sideToSui(input.creatorSide);
      const rate = requirePositiveBigInt(input.seedRate, "seedRate");
      const deposit = requirePositiveBigInt(input.creatorStake, "creatorStake");

      // The creator seeds the vault from its OWN USDC (the BOOKMAKER role is funded at deploy) — split
      // the deposit off the owned coin, exactly like the options fund flow.
      const usdcCoins = await findUsdcCoins(deposit);

      const tx = new Transaction();
      const primaryCoin = tx.object(usdcCoins[0]!);
      if (usdcCoins.length > 1) {
        tx.mergeCoins(
          primaryCoin,
          usdcCoins.slice(1).map((id) => tx.object(id))
        );
      }
      const [payment] = tx.splitCoins(primaryCoin, [tx.pure.u128(deposit)]);
      tx.moveCall({
        target: target(packageId, MODULES.vaultDriver, "create_vault"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.vaultDriverRegistry),
          tx.object(ids.vaultRegistry),
          tx.object(ids.marketRegistry),
          tx.object(ids.dripsRegistry),
          tx.object(ids.streamsRegistry),
          tx.pure(vecU8Arg(marketBytes)),
          tx.pure(vecU8Arg(questionBytes)),
          tx.pure.u8(side),
          tx.pure.u256(rate),
          tx.pure.u128(deposit),
          payment!,
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });

      const { account, client } = await getSui();
      tx.setGasBudgetIfNotSet(100_000_000);
      let result: { hash: string };
      try {
        result = await account.sendTransaction(tx);
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Sui createVault failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }

      const block = await client.waitForTransaction({
        digest: result.hash,
        options: { showEvents: true }
      });
      const vaultId = parseVaultCreated(block.events);
      if (vaultId === undefined) {
        throw new LiveStreakRuntimeError({
          message: "Sui createVault did not emit a decodable VaultCreated event"
        });
      }
      return { txId: asTxId(result.hash), vaultId };
    },

    // Sui transactions are synchronous (no pending-userOp recovery like EVM). Best-effort re-fetch the
    // tx by digest and re-parse the VaultCreated event; returns undefined if not found.
    confirmCreateVault: async (digest: TxId): Promise<CreateVaultResult | undefined> => {
      const { client } = await getSui();
      try {
        const block = await client.waitForTransaction({ digest, options: { showEvents: true } });
        const vaultId = parseVaultCreated(block.events);
        return vaultId === undefined ? undefined : { txId: digest, vaultId };
      } catch {
        return undefined;
      }
    }
  };
};

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Sui createVault requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};
