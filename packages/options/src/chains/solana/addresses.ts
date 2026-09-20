// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
// Multichain-hygiene: base58 validation via the wallet's re-exported kit `address()` (the single
// @solana/* owner). It throws on a malformed/wrong-length base58 pubkey — mirrors sui/addresses'
// object-id guard so a bad programId/usdcMint fails at config time, not mid-write.
import { address } from "@livestreak/wallet";

// Canonical Solana addresses for the options leg this phase: the deployed livestreak program id and
// the USDC SPL mint. Both base58 (32-byte pubkeys). Escrow/protocol/position accounts are PDAs
// derived from these, so nothing else needs configuring.
export type OptionsSolanaAddresses = {
  readonly programId: string;
  readonly usdcMint: string;
};

const validateBase58 = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: `Options Solana addresses require a non-empty ${field}`,
      metadata: { details: String(value) }
    });
  }
  try {
    // `address()` returns a branded Address on success and throws on an invalid base58 pubkey.
    return String(address(value.trim()));
  } catch (error) {
    throw new LiveStreakConfigError({
      message: `Invalid Solana ${field} (expected a base58 pubkey)`,
      metadata: { details: value, cause: error }
    });
  }
};

export const validateOptionsSolanaAddresses = (
  ids: OptionsSolanaAddresses
): OptionsSolanaAddresses => ({
  programId: validateBase58(ids?.programId, "programId"),
  usdcMint: validateBase58(ids?.usdcMint, "usdcMint")
});
