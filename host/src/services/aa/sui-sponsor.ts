import { LiveStreakConfigError } from "@livestreak/core";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { HostServerConfig } from "../../config/host.js";
import {
  resolveSuiSponsorRpcUrl,
  resolveSuiSponsorSeed,
  resolveSuiSponsorWallet
} from "../../infrastructure/wallet/sui.js";
import {
  isSuiGasStationRouteError,
  SUI_GAS_STATION_BUDGET_EXCEEDED,
  SUI_GAS_STATION_NOT_CONFIGURED,
  SUI_GAS_STATION_POOL_EXHAUSTED,
  type SuiGasStationRuntimeConfig
} from "./sui-gas-station.js";

// --- exports ---

export interface SuiSponsorRequestBody {
  readonly txKindBytes: string;
  readonly sender: string;
  readonly gasBudget?: number | string;
}

export type SuiSponsorRouteResult =
  | {
      readonly ok: true;
      readonly result: {
        readonly txBytes: string;
        readonly sponsorSignature: string;
        readonly sponsorAddress: string;
      };
    }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleSuiSponsor = async (
  body: unknown,
  deps: {
    readonly sponsor: (input: {
      readonly txKindBytes: Uint8Array;
      readonly sender: string;
      readonly gasBudget?: bigint;
    }) => Promise<{
      readonly txBytes: Uint8Array;
      readonly sponsorSignature: string;
      readonly sponsorAddress: string;
    }>;
  }
): Promise<SuiSponsorRouteResult> => {
  if (body === null || typeof body !== "object") {
    return sponsorFailure(400, "Request body must be a JSON object");
  }

  const request = body as Partial<SuiSponsorRequestBody>;
  if (typeof request.txKindBytes !== "string" || request.txKindBytes.length === 0) {
    return sponsorFailure(400, "txKindBytes must be a non-empty base64 string");
  }

  if (typeof request.sender !== "string" || request.sender.length === 0) {
    return sponsorFailure(400, "sender must be a Sui address");
  }

  let sender: string;
  try {
    sender = normalizeSuiAddress(request.sender);
  } catch {
    return sponsorFailure(400, "sender must be a valid Sui address");
  }

  if (!isValidSuiAddress(sender)) {
    return sponsorFailure(400, "sender must be a valid Sui address");
  }

  const txKindBytes = decodeBase64(request.txKindBytes);
  if (txKindBytes === null) {
    return sponsorFailure(400, "txKindBytes must be valid base64");
  }

  try {
    Transaction.fromKind(txKindBytes);
  } catch {
    return sponsorFailure(400, "txKindBytes does not parse as a Sui transaction kind");
  }

  const gasBudget = parseOptionalGasBudget(request.gasBudget);
  if (gasBudget === "invalid") {
    return sponsorFailure(400, "gasBudget must be a positive integer");
  }

  try {
    const sponsored = await deps.sponsor({
      txKindBytes,
      sender,
      ...(gasBudget === undefined ? {} : { gasBudget })
    });

    return {
      ok: true,
      result: {
        txBytes: Buffer.from(sponsored.txBytes).toString("base64"),
        sponsorSignature: sponsored.sponsorSignature,
        sponsorAddress: sponsored.sponsorAddress
      }
    };
  } catch (error) {
    if (isSuiGasStationRouteError(error)) {
      return sponsorFailure(error.status, error.message);
    }

    if (error instanceof LiveStreakConfigError) {
      return sponsorFailure(mapConfigErrorStatus(error), error.message);
    }

    return sponsorFailure(500, `Sui sponsor failed: ${String(error)}`);
  }
};

export const readSuiGasStationRuntimeConfig = async (
  config: HostServerConfig
): Promise<SuiGasStationRuntimeConfig | null> => {
  const seed = resolveSuiSponsorSeed(config);
  const rpcUrl = resolveSuiSponsorRpcUrl();
  if (seed === null || rpcUrl === null) {
    return null;
  }

  const sponsor = await resolveSuiSponsorWallet(config);
  const gasBudget = readBigIntEnv("LIVESTREAK_SUI_GAS_BUDGET", 5_000_000n);
  const maxGasBudget = readBigIntEnv("LIVESTREAK_SUI_MAX_GAS_BUDGET", gasBudget);
  const gasPrice = readBigIntEnv("LIVESTREAK_SUI_GAS_PRICE", 1_000n);

  return {
    rpcUrl,
    sponsorAddress: sponsor.address,
    sponsorKeypair: sponsor.keypair,
    gasBudget,
    gasPrice,
    maxGasBudget,
    poolSize: readIntEnv("LIVESTREAK_SUI_GAS_POOL_SIZE", 8),
    coinMistPerSlot: readBigIntEnv("LIVESTREAK_SUI_GAS_COIN_MIST", 50_000_000n),
    reserveTimeoutMs: readIntEnv("LIVESTREAK_SUI_GAS_RESERVE_TIMEOUT_MS", 60_000),
    minSponsorBalanceMist: readBigIntEnv("LIVESTREAK_SUI_MIN_SPONSOR_BALANCE_MIST", 100_000_000n)
  };
};

// --- helpers ---

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

const isValidSuiAddress = (value: string): boolean => SUI_ADDRESS_RE.test(value);

const decodeBase64 = (value: string): Uint8Array | null => {
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0) {
      return null;
    }

    return new Uint8Array(bytes);
  } catch {
    return null;
  }
};

const parseOptionalGasBudget = (
  value: number | string | undefined
): bigint | undefined | "invalid" => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "string" ? BigInt(value) : BigInt(Math.trunc(value));
  if (parsed <= 0n) {
    return "invalid";
  }

  return parsed;
};

const sponsorFailure = (status: number, message: string): SuiSponsorRouteResult => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: status === 429 || status === 503 }
  })
});

const mapConfigErrorStatus = (error: LiveStreakConfigError): number => {
  if (error.message.includes(SUI_GAS_STATION_NOT_CONFIGURED) || error.message.includes("not_configured")) {
    return 503;
  }

  if (error.message.includes(SUI_GAS_STATION_POOL_EXHAUSTED) || error.message.includes("pool_exhausted")) {
    return 429;
  }

  if (
    error.message.includes(SUI_GAS_STATION_BUDGET_EXCEEDED) ||
    error.message.includes("budget_exceeded") ||
    error.message.includes("underfunded")
  ) {
    return 400;
  }

  return 400;
};

const readIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readBigIntEnv = (name: string, fallback: bigint): bigint => {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  try {
    const parsed = BigInt(raw);
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
};
