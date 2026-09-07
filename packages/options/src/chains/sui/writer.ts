// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build PTBs + read VIA @livestreak/wallet (the single @mysten/sui v2 owner),
// not a direct @mysten/sui dependency.
import {
  Transaction,
  SuiJsonRpcClient,
  bcs,
  createSuiReadClient,
  createWalletManager,
  type SuiWalletConfig
} from "@livestreak/wallet";
import { MODULES, target } from "@livestreak/contracts/sui";

import { validateOptionsVaultSide } from "../../model/vault.js";
import { asTokenId, type TokenId } from "../../model/ids.js";
import {
  asTxId,
  type AdvanceInput,
  type ApproveNftInput,
  type ClaimLossLvstInput,
  type FundStreamInput,
  type MintNftInput,
  type MintResult,
  type MintWithSaltInput,
  type OptionsChainConfig,
  type OptionsWriter,
  type SetApprovalForAllInput,
  type SetLanesInput,
  type StakeLvstInput,
  type StopAllFundingInput,
  type StopFundingInput,
  type TransferNftInput,
  type UnstakeLvstInput,
  type WithdrawInput,
  type WithdrawManyInput
} from "../types.js";
import { validateSuiBytes32Id, type OptionsSuiObjectIds } from "./addresses.js";
import { sideToSuiValue } from "./decode.js";
import { validateSuiUserAddress } from "./account.js";

// Sui clock object is always the same system object.
const SUI_CLOCK_OBJECT_ID = "0x6";

// Build the raw 32-byte array from a hex vault/market ID string (validated — OPT.sui-validate; a
// malformed/short id used to silently zero-pad).
const vaultIdByteArray = (id: string, field = "vaultId"): number[] => {
  const validated = validateSuiBytes32Id(id, field);
  const hex = validated.startsWith("0x") ? validated.slice(2) : validated;
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

// Build a pure bytes32 vector argument from a hex vault/market ID string.
const vaultIdBytes = (id: string): Uint8Array =>
  bcs.vector(bcs.u8()).serialize(vaultIdByteArray(id)).toBytes();

export const createSuiOptionsWriter = (config: OptionsChainConfig): OptionsWriter => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({
      message: "Sui options writer requires walletInit.chain === sui"
    });
  }

  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const ids = config.addresses as OptionsSuiObjectIds;
  const packageId = ids.packageId;
  const coinType = `${packageId}::mock_usdc::MOCK_USDC`;

  // OPT.rederive: derive the account/owner/client ONCE per writer (deterministic) and reuse across
  // send + findNftObjectId + findCoinObject instead of re-deriving the wallet on every call.
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
        const rpcUrl = Array.isArray(suiConfig.rpcUrl)
          ? suiConfig.rpcUrl[0]
          : (suiConfig.rpcUrl ?? "");
        const client = createSuiReadClient(rpcUrl as string);
        return { account, owner, client };
      })();
    }
    return suiPromise;
  };

  const send = async (tx: Transaction): Promise<string> => {
    const { account } = await getSui();
    tx.setGasBudgetIfNotSet(100_000_000);
    let result: { hash: string };
    try {
      result = await account.sendTransaction(tx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LiveStreakRuntimeError({
        message: `Sui transaction failed: ${message}`
      });
    }
    return result.hash;
  };

  // Read the minted tokenId from the MarketNftMinted event in the tx effects (mint auto-assigns it).
  const sendMint = async (tx: Transaction): Promise<MintResult> => {
    const hash = await send(tx);
    const { client } = await getSui();
    try {
      const block = await client.waitForTransaction({
        digest: hash,
        options: { showEvents: true }
      });
      const event = block.events?.find((e) => e.type.includes("MarketNftMinted"));
      const parsed = event?.parsedJson as { token_id?: string } | undefined;
      if (parsed?.token_id !== undefined) {
        return { txId: asTxId(hash), tokenId: asTokenId(BigInt(parsed.token_id)) };
      }
    } catch (error) {
      throw new LiveStreakRuntimeError({
        message: `Sui: failed to read MarketNftMinted event: ${
          error instanceof Error ? error.message : String(error)
        }`
      });
    }
    throw new LiveStreakRuntimeError({
      message: "Sui: mint tx did not emit a decodable MarketNftMinted event"
    });
  };

  const findNftObjectId = async (tokenId: bigint): Promise<string> => {
    // Locate the NFT object by scanning owned objects. The sender owns the NFT for write ops.
    const { owner, client } = await getSui();
    const nftType = `${packageId}::market_driver::MarketPositionNFT`;
    const owned = await client.getOwnedObjects({
      owner,
      filter: { StructType: nftType },
      options: { showContent: true }
    });
    for (const obj of owned.data) {
      if (obj.data?.content?.dataType === "moveObject") {
        const fields = obj.data.content.fields as Record<string, unknown>;
        if (BigInt(String(fields["token_id"])) === tokenId) {
          return obj.data.objectId;
        }
      }
    }
    throw new LiveStreakConfigError({
      message: `Sui: NFT object not found for tokenId ${tokenId.toString()}`
    });
  };

  const findCoinObject = async (coinType_: string, amount: bigint): Promise<string[]> => {
    const { owner, client } = await getSui();
    const coins = await client.getCoins({ owner, coinType: coinType_ });
    let total = 0n;
    const objectIds: string[] = [];
    for (const coin of coins.data) {
      objectIds.push(coin.coinObjectId);
      total += BigInt(coin.balance);
      if (total >= amount) break;
    }
    if (total < amount) {
      throw new LiveStreakConfigError({
        message: `Sui: insufficient ${coinType_} balance`,
        metadata: { details: `need ${amount}, have ${total}` }
      });
    }
    return objectIds;
  };

  return {
    mint: async (input: MintNftInput): Promise<MintResult> => {
      const marketBytes = vaultIdByteArray(input.marketId, "marketId");
      const to = validateSuiUserAddress(input.to, "to");
      const metadataType = `${packageId}::driver_utils::AccountMetadata` as const;

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "mint"),
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(ids.marketRegistry),
          tx.pure(bcs.vector(bcs.u8()).serialize(marketBytes).toBytes()),
          tx.pure.address(to),
          tx.makeMoveVec({ type: metadataType, elements: [] })
        ]
      });
      return sendMint(tx);
    },

    // Sui's market_driver has no salted-mint entry (tokenId is auto-assigned on chain); deterministic
    // mintWithSalt is an EVM-only feature (calcTokenIdWithSalt). Surface it explicitly.
    mintWithSalt: async (_input: MintWithSaltInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Sui: mintWithSalt not supported (no salted-mint Move entry; tokenId is auto-assigned)"
      });
    },

    fund: async (input: FundStreamInput) => {
      const vaultId = input.vaultId;
      const side = sideToSuiValue(validateOptionsVaultSide(input.side));
      const rate = requirePositiveBigInt(input.rate, "rate");
      const deposit = requirePositiveBigInt(input.deposit, "deposit");

      const nftObjectId = await findNftObjectId(input.tokenId);
      const usdcCoins = await findCoinObject(coinType, deposit);
      const vaultBytes = vaultIdBytes(vaultId);

      const tx = new Transaction();
      const primaryCoin = tx.object(usdcCoins[0]!);
      if (usdcCoins.length > 1) {
        tx.mergeCoins(primaryCoin, usdcCoins.slice(1).map((id) => tx.object(id)));
      }
      const [payment] = tx.splitCoins(primaryCoin, [tx.pure.u128(deposit)]);
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "fund"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultDriverRegistry),
          tx.object(ids.vaultRegistry),
          tx.object(ids.dripsRegistry),
          tx.object(ids.streamsRegistry),
          tx.pure(vaultBytes),
          tx.pure.u8(side),
          tx.pure.u256(rate),
          tx.pure.u128(deposit),
          payment,
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    advance: async (input: AdvanceInput) => {
      const vaultBytes = vaultIdBytes(input.vaultId);
      const side = sideToSuiValue(validateOptionsVaultSide(input.side));
      const maxSteps = input.maxSteps ?? 0n;

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.vault, "advance"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.vaultRegistry),
          tx.pure(vaultBytes),
          tx.pure.u8(side),
          tx.pure.u64(maxSteps),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    setLanes: async (input: SetLanesInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const addDeposit = requireNonNegativeBigInt(input.addDeposit, "addDeposit");

      const desiredVaultIds = input.lanes.map((l) => vaultIdByteArray(l.vaultId, "vaultId"));
      const desiredSides = input.lanes.map((l) => sideToSuiValue(validateOptionsVaultSide(l.side)));
      const desiredRates = input.lanes.map((l) => requirePositiveBigInt(l.rate, "rate"));

      // O7: when add_deposit > 0, resolve + split a USDC coin and pass Some(coin); else None. The Move
      // entry takes Option<Coin<T>>, which can't be a pure argument — build it with 0x1::option in the
      // PTB. (The previous code always passed an Option<u64> None, so add-deposit silently never funded.)
      const coinOptionInner = `0x2::coin::Coin<${coinType}>`;

      const tx = new Transaction();
      let paymentArg;
      if (addDeposit > 0n) {
        const usdcCoins = await findCoinObject(coinType, addDeposit);
        const primaryCoin = tx.object(usdcCoins[0]!);
        if (usdcCoins.length > 1) {
          tx.mergeCoins(primaryCoin, usdcCoins.slice(1).map((id) => tx.object(id)));
        }
        const [payment] = tx.splitCoins(primaryCoin, [tx.pure.u128(addDeposit)]);
        paymentArg = tx.moveCall({
          target: "0x1::option::some",
          typeArguments: [coinOptionInner],
          arguments: [payment!]
        });
      } else {
        paymentArg = tx.moveCall({
          target: "0x1::option::none",
          typeArguments: [coinOptionInner]
        });
      }

      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "set_lanes"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultDriverRegistry),
          tx.object(ids.vaultRegistry),
          tx.object(ids.dripsRegistry),
          tx.object(ids.streamsRegistry),
          tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(desiredVaultIds).toBytes()),
          tx.pure(bcs.vector(bcs.u8()).serialize(desiredSides).toBytes()),
          tx.pure(bcs.vector(bcs.u256()).serialize(desiredRates).toBytes()),
          tx.pure.u128(addDeposit),
          paymentArg,
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    stopFunding: async (input: StopFundingInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const vaultBytes = vaultIdBytes(input.vaultId);
      const side = sideToSuiValue(validateOptionsVaultSide(input.side));

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "stop"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultDriverRegistry),
          tx.object(ids.vaultRegistry),
          tx.object(ids.dripsRegistry),
          tx.object(ids.streamsRegistry),
          tx.pure(vaultBytes),
          tx.pure.u8(side),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    stopAllFunding: async (input: StopAllFundingInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "stop_all"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultDriverRegistry),
          tx.object(ids.vaultRegistry),
          tx.object(ids.dripsRegistry),
          tx.object(ids.streamsRegistry),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    withdraw: async (input: WithdrawInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const vaultBytes = vaultIdBytes(input.vaultId);
      const to = validateSuiUserAddress(input.to, "to");

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "withdraw"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultRegistry),
          tx.pure(vaultBytes),
          tx.pure.address(to),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    withdrawMany: async (input: WithdrawManyInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const to = validateSuiUserAddress(input.to, "to");
      const vaultIds = bcs
        .vector(bcs.vector(bcs.u8()))
        .serialize(input.vaultIds.map((v) => vaultIdByteArray(v)))
        .toBytes();

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "withdraw_many"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.vaultRegistry),
          tx.pure(vaultIds),
          tx.pure.address(to),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });
      return asTxId(await send(tx));
    },

    claimLossLvst: async (input: ClaimLossLvstInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const vaultBytes = vaultIdBytes(input.vaultId);
      const side = sideToSuiValue(validateOptionsVaultSide(input.side));
      const to = validateSuiUserAddress(input.to, "to");

      if (ids.lvstTreasuryCap === undefined) {
        throw new LiveStreakConfigError({
          message: "Sui: claimLossLvst requires lvstTreasuryCap in addresses config"
        });
      }
      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketDriver, "claim_loss_lvst"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.marketDriverRegistry),
          tx.object(nftObjectId),
          tx.object(ids.treasuryRegistry),
          tx.object(ids.lvstTreasuryCap),
          tx.object(ids.vaultRegistry),
          tx.pure(vaultBytes),
          tx.pure.u8(side),
          tx.pure.address(to)
        ]
      });
      return asTxId(await send(tx));
    },

    stakeLvst: async (input: StakeLvstInput) => {
      const amount = requirePositiveBigInt(input.amount, "amount");
      const lvstCoinType = `${packageId}::lvst::LVST`;
      const lvstCoins = await findCoinObject(lvstCoinType, amount);

      const tx = new Transaction();
      const primaryCoin = tx.object(lvstCoins[0]!);
      if (lvstCoins.length > 1) {
        tx.mergeCoins(primaryCoin, lvstCoins.slice(1).map((id) => tx.object(id)));
      }
      const [payment] = tx.splitCoins(primaryCoin, [tx.pure.u64(amount)]);
      tx.moveCall({
        target: target(packageId, MODULES.treasury, "stake_lvst"),
        typeArguments: [coinType],
        arguments: [tx.object(ids.treasuryRegistry), payment]
      });
      return asTxId(await send(tx));
    },

    unstakeLvst: async (input: UnstakeLvstInput) => {
      const amount = requirePositiveBigInt(input.amount, "amount");

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.treasury, "unstake_lvst"),
        typeArguments: [coinType],
        arguments: [tx.object(ids.treasuryRegistry), tx.pure.u128(amount)]
      });
      return asTxId(await send(tx));
    },

    claimDividends: async () => {
      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.treasury, "claim_dividends"),
        typeArguments: [coinType],
        arguments: [tx.object(ids.treasuryRegistry)]
      });
      return asTxId(await send(tx));
    },

    transferNft: async (input: TransferNftInput) => {
      const nftObjectId = await findNftObjectId(input.tokenId);
      const to = validateSuiUserAddress(input.to, "to");
      const nftType = `${packageId}::market_driver::MarketPositionNFT`;

      const tx = new Transaction();
      // public_transfer requires no custom Move fn — use the PTB transfer instruction.
      tx.transferObjects([tx.object(nftObjectId)], tx.pure.address(to));
      void nftType; // transferObjects handles the type natively.
      return asTxId(await send(tx));
    },

    // Sui owned-object model has no approval mechanism.
    approveNft: async (_input: ApproveNftInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Sui: approveNft not supported (owned-object model)"
      });
    },

    setApprovalForAll: async (_input: SetApprovalForAllInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Sui: setApprovalForAll not supported (owned-object model)"
      });
    }
  };
};

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Sui write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};

const requireNonNegativeBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new LiveStreakConfigError({
      message: `Sui write requires ${field} to be a bigint >= 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};
