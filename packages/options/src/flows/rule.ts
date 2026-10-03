import type { VerifiedVaultMandate } from "@livestreak/schema";
import { LiveStreakConfigError } from "@livestreak/core";
/** Takes a verified authoritative read, never a Bookmaker-supplied expected hash. */
export const requireOpenMandate = (verified: VerifiedVaultMandate | undefined, nowSeconds: number): VerifiedVaultMandate => {
  if (!verified) throw new LiveStreakConfigError({message:"Verified vault mandate unavailable — funding disabled"});
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds >= verified.mandate.fundingClose) throw new LiveStreakConfigError({message:"Vault funding closed"});
  return verified;
};
