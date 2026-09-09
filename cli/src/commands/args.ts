import { Options } from "@effect/cli";
import { Option } from "effect";
import { asTokenId, asVaultId, validateOptionsVaultSide, type LaneWriteInput } from "@livestreak/options";

export const configOpt = Options.file("config").pipe(
  Options.withDescription("Path to livestreak.json"),
  Options.optional
);

export const passwordOpt = Options.text("password").pipe(Options.optional);

export const marketOpt = Options.text("market").pipe(Options.optional);

export const tokenOpt = Options.text("token").pipe(
  Options.withDescription(
    "Position NFT token id (defaults to run.tokenId; settle discovers it on-chain if omitted)"
  ),
  Options.optional
);

export const readCommandConfig = (
  config: Option.Option<string>,
  password: Option.Option<string>
) => ({
  ...(Option.isSome(config) ? { configPath: config.value } : {}),
  ...(Option.isSome(password) ? { password: password.value } : {})
});

export const parseTokenId = (value: string): ReturnType<typeof asTokenId> => {
  try {
    return asTokenId(BigInt(value));
  } catch {
    throw new Error("token must be a numeric token id");
  }
};

/** Resolve --token or fall back to the persisted run cache tokenId. */
export const resolveTokenArg = (
  token: string | undefined,
  runTokenId: string | undefined
): string => {
  if (token !== undefined && token.trim().length > 0) {
    return token.trim();
  }

  if (runTokenId !== undefined && runTokenId.trim().length > 0) {
    return runTokenId.trim();
  }

  throw new Error(
    "token required: pass --token or mint an NFT first (persisted as run.tokenId in livestreak.json)"
  );
};

export const parseBigIntArg = (value: string, label: string): bigint => {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error(`${label} must be > 0`);
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a positive integer string`);
  }
};

/** EVM LVST = 18 decimals; Sui LVST = 9 (D2 decision — chain-local). */
export const LVST_DECIMALS_EVM = 18;
export const LVST_DECIMALS_SUI = 9;

export const parseHumanLvstAmount = (
  value: string,
  chain: "evm" | "sui" = "evm"
): bigint => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("amount must be a positive decimal LVST quantity (e.g. 400 or 0.5)");
  }

  const decimals = chain === "sui" ? LVST_DECIMALS_SUI : LVST_DECIMALS_EVM;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimal places for ${chain} LVST`);
  }

  const scale = 10n ** BigInt(decimals);
  const raw = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0"));
  if (raw <= 0n) {
    throw new Error("amount must be > 0");
  }

  return raw;
};

export const parseNonNegativeBigIntArg = (value: string, label: string): bigint => {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error(`${label} must be >= 0`);
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a non-negative integer string`);
  }
};

export const parseApprovedFlag = (value: boolean): boolean => value;

/** Parse `vaultId:side:rate` into a LaneWriteInput (side branded via options). */
export const parseLaneSpec = (spec: string): LaneWriteInput => {
  const trimmed = spec.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 3) {
    throw new Error(`lane must be vaultId:side:rate, got "${spec}"`);
  }

  const [vaultId, sideRaw, rateRaw] = parts;
  if (vaultId === undefined || sideRaw === undefined || rateRaw === undefined) {
    throw new Error(`lane must be vaultId:side:rate, got "${spec}"`);
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(vaultId)) {
    throw new Error(`lane vaultId must be a 0x-prefixed bytes32, got "${vaultId}"`);
  }

  const rate = parseBigIntArg(rateRaw, "lane rate");

  return {
    vaultId: asVaultId(vaultId.toLowerCase()),
    side: validateOptionsVaultSide(sideRaw),
    rate
  };
};

export const parseLaneSpecs = (specs: readonly string[]): readonly LaneWriteInput[] => {
  if (specs.length === 0) {
    throw new Error("at least one --lane vaultId:side:rate is required");
  }

  return specs.map(parseLaneSpec);
};

export const parseVaultId = (value: string): ReturnType<typeof asVaultId> => {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(trimmed)) {
    throw new Error(`vault id must be a 0x-prefixed bytes32, got "${value}"`);
  }
  return asVaultId(trimmed);
};

export const parseVaultIdList = (value: string): readonly ReturnType<typeof asVaultId>[] => {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error("vaults must be a comma-separated list of vault ids");
  }

  return parts.map((vaultId) => parseVaultId(vaultId));
};

export const parseMarketIdArg = (value: string): `0x${string}` => {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(trimmed)) {
    throw new Error(`market id must be a 0x-prefixed bytes32, got "${value}"`);
  }
  return trimmed as `0x${string}`;
};
