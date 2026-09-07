// Steward resolution edge. The keynote loop SETTLES only once a steward resolves a vault, and on-chain
// the `defaultSteward` is the dev-key EOA (anvil acct 0, 0xf39F…) — NOT the operator's AA Safe. The
// prior edge signed `resolveVault` through the operator AA wallet (0x6083…), so the registry's
// `onlyMarketSteward` guard always reverted ("not market steward") [e2e bug #1].
//
// FIX (permutation (a) — sign as the steward's OWN identity, the most faithful): the steward is a
// distinct privileged signer the CLI provides, so we sign `resolveVault(vaultId, outcome)` from the
// steward EOA via a plain viem WalletClient (NOT the AA bundler path). This also satisfies #12 for
// resolve: the writer owns its own wallet built from the provided steward key — the CLI only holds
// the keystore and hands the package/edge an identity, it does not reuse the operator Safe here.
//
// Dispatch is per-chain (EVM today; Sui pending the CLI Sui operator leg — see scope-e2e-agent.md
// §A/§F). Outcome encoding matches the on-chain `Vault.Outcome` enum on BOTH chains:
// { Pending: 0, Yes: 1, No: 2 } (EVM Vault.sol) === { OUTCOME_YES: 1, OUTCOME_NO: 2 } (Sui).

import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type VaultOutcome = "yes" | "no";

/** On-chain `Vault.Outcome` enum values (shared EVM + Sui). */
export const OUTCOME_SOLIDITY = { pending: 0, yes: 1, no: 2 } as const;

/** Parse a `<outcome>` CLI argument into the canonical winning side. */
export const parseOutcomeArg = (value: string): VaultOutcome => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "no") {
    return normalized;
  }
  throw new Error(`outcome must be "yes" or "no", got "${value}"`);
};

/** Map a winning side to its `Vault.Outcome` enum value (yes -> 1, no -> 2). */
export const outcomeToSolidityValue = (outcome: VaultOutcome): number =>
  outcome === "yes" ? OUTCOME_SOLIDITY.yes : OUTCOME_SOLIDITY.no;

/** ABI-encode the steward registry `resolveVault(bytes32 vaultId, Vault.Outcome outcome)` call. */
export const encodeResolveVaultCall = (
  vaultId: `0x${string}`,
  outcome: VaultOutcome
): `0x${string}` =>
  encodeFunctionData({
    abi: stewardRegistryAbi,
    functionName: "resolveVault",
    args: [vaultId, outcomeToSolidityValue(outcome)]
  });

/**
 * Signs + lands a `resolveVault` calldata blob from the STEWARD identity, returning the tx hash.
 * Injectable so the EOA viem path can be swapped for a fake in tests (and a Sui signer later).
 */
export interface StewardSigner {
  resolve(input: {
    readonly stewardRegistry: `0x${string}`;
    readonly data: `0x${string}`;
  }): Promise<string>;
}

/** The well-known anvil acct-0 key (public, deterministic) — the localnet deployer == defaultSteward.
 * NOT a secret; used ONLY as the dev default on chainId 31337 so the e2e harness resolves out of the
 * box. Real chains MUST supply LIVESTREAK_STEWARD_KEY. */
const ANVIL_DEV_STEWARD_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Resolve the steward EOA private key without baking a secret: env first, dev-chain fallback last. */
export const resolveStewardKey = (chainId: number): Hex => {
  const fromEnv = process.env["LIVESTREAK_STEWARD_KEY"];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    const k = fromEnv.trim();
    return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  }
  if (chainId === 31337) {
    return ANVIL_DEV_STEWARD_KEY;
  }
  throw new Error(
    "steward key required: set LIVESTREAK_STEWARD_KEY to the defaultSteward EOA private key " +
      `(no dev fallback for chainId ${chainId})`
  );
};

/** Build a viem-EOA steward signer that owns its own wallet (the steward's identity, not the Safe). */
export const createEoaStewardSigner = (input: {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly privateKey: Hex;
}): StewardSigner => {
  const account = privateKeyToAccount(input.privateKey);
  const chain = {
    id: input.chainId,
    name: "livestreak",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [input.rpcUrl] } }
  } as const;
  const wallet = createWalletClient({ account, chain, transport: http(input.rpcUrl) });

  return {
    resolve: async ({ stewardRegistry, data }) =>
      wallet.sendTransaction({ to: stewardRegistry, data, value: 0n })
  };
};

export interface ResolveVaultEvmInput {
  /** Steward identity signer (EOA on EVM today). */
  readonly signer: StewardSigner;
  /** Steward registry contract address (from livestreak.json options.stewardRegistry). */
  readonly stewardRegistry: `0x${string}`;
  readonly vaultId: `0x${string}`;
  readonly outcome: VaultOutcome;
}

/**
 * Resolve a vault on EVM by signing `resolveVault` from the steward EOA and returning the tx hash.
 */
export const resolveVaultEvm = async (input: ResolveVaultEvmInput): Promise<string> => {
  const data = encodeResolveVaultCall(input.vaultId, input.outcome);
  return input.signer.resolve({ stewardRegistry: input.stewardRegistry, data });
};
