import { LiveStreakConfigError } from "@livestreak/core";
import type { SuiGasCoinRef } from "@livestreak/wallet";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

// --- exports ---

export type SuiGasStationSponsorResult = {
  readonly txBytes: Uint8Array;
  readonly sponsorSignature: string;
  readonly sponsorAddress: string;
};

export const SUI_GAS_STATION_POOL_EXHAUSTED = "sui_gas_station_pool_exhausted" as const;
export const SUI_GAS_STATION_NOT_CONFIGURED = "sui_gas_station_not_configured" as const;
export const SUI_GAS_STATION_UNDERFUNDED = "sponsor_underfunded" as const;
export const SUI_GAS_STATION_BUDGET_EXCEEDED = "sui_gas_budget_exceeded" as const;

export interface SuiGasStationRuntimeConfig {
  readonly rpcUrl: string;
  readonly sponsorAddress: string;
  readonly sponsorKeypair: Ed25519Keypair;
  readonly gasBudget: bigint;
  readonly gasPrice: bigint;
  readonly maxGasBudget: bigint;
  readonly poolSize: number;
  readonly coinMistPerSlot: bigint;
  readonly reserveTimeoutMs: number;
  readonly minSponsorBalanceMist: bigint;
}

export interface SuiGasStationService {
  readonly configured: boolean;
  readonly advertise: boolean;
  readonly sponsorAddress: string | null;
  readonly sponsorshipMode: "dev_open";
  readonly gasStationPath: string;
  bootstrap(): Promise<void>;
  sponsor(input: {
    readonly txKindBytes: Uint8Array;
    readonly sender: string;
    readonly gasBudget?: bigint;
  }): Promise<SuiGasStationSponsorResult>;
  poolStats(): { readonly available: number; readonly reserved: number };
}

export interface CreateSuiGasStationOptions {
  readonly config: SuiGasStationRuntimeConfig | null;
  readonly client?: SuiJsonRpcClient;
  readonly initialCoins?: readonly SuiGasCoinRef[];
  readonly now?: () => number;
}

export const createSuiGasStation = (options: CreateSuiGasStationOptions): SuiGasStationService => {
  if (options.config === null) {
    return createDisabledSuiGasStation();
  }

  return createEnabledSuiGasStation(options.config, options);
};

// --- helpers ---

interface ReservedCoin {
  readonly coin: SuiGasCoinRef;
  readonly reservedAtMs: number;
}

interface SuiCoinBalanceRow {
  readonly objectId: string;
  readonly version: string;
  readonly digest: string;
  readonly balance: bigint;
}

const createDisabledSuiGasStation = (): SuiGasStationService => ({
  configured: false,
  advertise: false,
  sponsorAddress: null,
  sponsorshipMode: "dev_open",
  gasStationPath: "/aa/sui/sponsor",
  async bootstrap() {
    return;
  },
  async sponsor() {
    throw gasStationError(SUI_GAS_STATION_NOT_CONFIGURED, "Sui gas station is not configured", 503);
  },
  poolStats: () => ({ available: 0, reserved: 0 })
});

const createEnabledSuiGasStation = (
  config: SuiGasStationRuntimeConfig,
  options: CreateSuiGasStationOptions
): SuiGasStationService => {
  const now = options.now ?? (() => Date.now());
  let available: SuiGasCoinRef[] = [...(options.initialCoins ?? [])];
  const reserved = new Map<string, ReservedCoin>();
  let bootstrapped = options.initialCoins !== undefined;
  let advertise = true;

  const reapTimedOut = (): void => {
    const cutoff = now() - config.reserveTimeoutMs;
    for (const [objectId, entry] of reserved.entries()) {
      if (entry.reservedAtMs <= cutoff) {
        reserved.delete(objectId);
        available.push(entry.coin);
      }
    }
  };

  const reserveCoin = (): SuiGasCoinRef => {
    reapTimedOut();
    const coin = available.pop();
    if (coin === undefined) {
      throw gasStationError(
        SUI_GAS_STATION_POOL_EXHAUSTED,
        "Sui gas station pool exhausted",
        429
      );
    }

    reserved.set(coin.objectId, { coin, reservedAtMs: now() });
    return coin;
  };

  const releaseCoin = (objectId: string): void => {
    const entry = reserved.get(objectId);
    if (entry === undefined) {
      return;
    }

    reserved.delete(objectId);
    available.push(entry.coin);
  };

  const assertBudgetWithinPolicy = (requested?: bigint): bigint => {
    const budget = requested ?? config.gasBudget;
    if (budget > config.maxGasBudget) {
      throw gasStationError(
        SUI_GAS_STATION_BUDGET_EXCEEDED,
        `Requested gas budget ${budget} exceeds max ${config.maxGasBudget}`,
        400
      );
    }

    return budget;
  };

  const bootstrap = async (): Promise<void> => {
    if (bootstrapped) {
      return;
    }

    try {
      const client = requireClient(options);
      const balanceMist = await readSponsorBalanceMist(client, config.sponsorAddress);
      const requiredMist =
        config.minSponsorBalanceMist +
        config.coinMistPerSlot * BigInt(config.poolSize);

      if (balanceMist < requiredMist) {
        advertise = false;
        throw new LiveStreakConfigError({
          message: `${SUI_GAS_STATION_UNDERFUNDED}: sponsor balance ${balanceMist} mist < required ${requiredMist}`,
          metadata: { retryable: false }
        });
      }

      const fundingCoin = await pickFundingCoin(client, config.sponsorAddress, requiredMist);
      const splitCoins = await splitFundingCoin(
        client,
        config.sponsorKeypair,
        fundingCoin,
        config.sponsorAddress,
        config.poolSize,
        config.coinMistPerSlot
      );

      available = splitCoins;
      bootstrapped = true;
    } catch (error) {
      if (error instanceof LiveStreakConfigError && error.message.includes(SUI_GAS_STATION_UNDERFUNDED)) {
        advertise = false;
      }

      throw error;
    }
  };

  return {
    configured: true,
    get advertise() {
      return advertise;
    },
    sponsorAddress: config.sponsorAddress,
    sponsorshipMode: "dev_open",
    gasStationPath: "/aa/sui/sponsor",

    bootstrap,

    async sponsor(input) {
      if (!advertise) {
        throw gasStationError(
          SUI_GAS_STATION_NOT_CONFIGURED,
          "Sui gas station is not available",
          503
        );
      }

      if (!bootstrapped) {
        await bootstrap();
      }

      const gasBudget = assertBudgetWithinPolicy(input.gasBudget);
      const reservedCoin = reserveCoin();
      const client = requireClient(options);

      return assembleSponsoredTxBytes({
        kindBytes: input.txKindBytes,
        sender: input.sender,
        sponsorKeypair: config.sponsorKeypair,
        gasCoins: [reservedCoin],
        gasBudget,
        gasPrice: config.gasPrice,
        client
      });
    },

    poolStats: () => ({
      available: available.length,
      reserved: reserved.size
    })
  };
};

const assembleSponsoredTxBytes = async (input: {
  readonly kindBytes: Uint8Array;
  readonly sender: string;
  readonly sponsorKeypair: Ed25519Keypair;
  readonly gasCoins: SuiGasCoinRef[];
  readonly gasBudget: bigint;
  readonly gasPrice: bigint;
  readonly client: SuiJsonRpcClient;
}): Promise<SuiGasStationSponsorResult> => {
  const sponsorAddress = input.sponsorKeypair.getPublicKey().toSuiAddress();
  const transaction = Transaction.fromKind(input.kindBytes);
  transaction.setSender(input.sender);
  transaction.setGasOwner(sponsorAddress);
  transaction.setGasPayment(input.gasCoins);
  transaction.setGasBudget(input.gasBudget);
  transaction.setGasPrice(input.gasPrice);

  const txBytes = await transaction.build({ client: input.client });
  const { signature: sponsorSignature } = await input.sponsorKeypair.signTransaction(txBytes);

  return { txBytes, sponsorSignature, sponsorAddress };
};

const requireClient = (options: CreateSuiGasStationOptions): SuiJsonRpcClient => {
  if (options.client === undefined) {
    throw new Error("sui_client_required");
  }

  return options.client;
};

const readSponsorBalanceMist = async (
  client: SuiJsonRpcClient,
  sponsorAddress: string
): Promise<bigint> => {
  const balance = await client.core.getBalance({ owner: sponsorAddress });
  return BigInt(balance.balance.balance);
};

const pickFundingCoin = async (
  client: SuiJsonRpcClient,
  sponsorAddress: string,
  requiredMist: bigint
): Promise<SuiGasCoinRef> => {
  const coins = await client.core.listCoins({ owner: sponsorAddress, coinType: "0x2::sui::SUI" });
  const candidate = coins.objects
    .map(
      (coin): SuiCoinBalanceRow => ({
        objectId: coin.objectId,
        version: coin.version,
        digest: coin.digest,
        balance: BigInt(coin.balance)
      })
    )
    .sort((left: SuiCoinBalanceRow, right: SuiCoinBalanceRow) =>
      left.balance > right.balance ? -1 : 1
    )[0];

  if (candidate === undefined || candidate.balance < requiredMist) {
    throw new LiveStreakConfigError({
      message: `${SUI_GAS_STATION_UNDERFUNDED}: no funding coin large enough for pool split`,
      metadata: { retryable: false }
    });
  }

  return {
    objectId: candidate.objectId,
    version: candidate.version,
    digest: candidate.digest
  };
};

const listPoolCoins = async (
  client: SuiJsonRpcClient,
  sponsorAddress: string,
  poolSize: number,
  coinMistPerSlot: bigint
): Promise<SuiGasCoinRef[]> =>
  (await client.core.listCoins({ owner: sponsorAddress, coinType: "0x2::sui::SUI" })).objects
    .filter((coin) => BigInt(coin.balance) >= coinMistPerSlot)
    .slice(0, poolSize)
    .map((coin) => ({
      objectId: coin.objectId,
      version: coin.version,
      digest: coin.digest
    }));

const splitFundingCoin = async (
  client: SuiJsonRpcClient,
  sponsorKeypair: Ed25519Keypair,
  fundingCoin: SuiGasCoinRef,
  sponsorAddress: string,
  poolSize: number,
  coinMistPerSlot: bigint
): Promise<SuiGasCoinRef[]> => {
  const tx = new Transaction();
  const amounts = Array.from({ length: poolSize }, () => coinMistPerSlot);
  const split = tx.splitCoins(tx.object(fundingCoin.objectId), amounts);
  tx.transferObjects(split, sponsorAddress);
  tx.setGasPayment([fundingCoin]);

  const built = await tx.build({ client });
  const { signature } = await sponsorKeypair.signTransaction(built);
  await client.core.executeTransaction({
    transaction: built,
    signatures: [signature]
  });

  const listed = await listPoolCoins(client, sponsorAddress, poolSize, coinMistPerSlot);
  if (listed.length < poolSize) {
    throw new Error("sui_gas_pool_split_incomplete");
  }

  return listed;
};

export class SuiGasStationRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const gasStationError = (code: string, message: string, status: number): SuiGasStationRouteError =>
  new SuiGasStationRouteError(code, message, status);

export const isSuiGasStationRouteError = (error: unknown): error is SuiGasStationRouteError =>
  error instanceof SuiGasStationRouteError;
