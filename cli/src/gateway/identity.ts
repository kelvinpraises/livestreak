import { createHash } from "node:crypto";

export const STEALTH_DOMAIN = "livestreak-stealth-v1";

export interface ResolvedOperator {
  readonly seed: Uint8Array;
  readonly seedHex: `0x${string}`;
}

/** Testnet-only password → seed (matches the app). */
export const deriveSeedFromPassword = (password: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(STEALTH_DOMAIN + password).digest());

export const resolveOperator = (password: string): ResolvedOperator => {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error(
      "Operator password required: set LIVESTREAK_PASSWORD or pass --password"
    );
  }

  const seed = deriveSeedFromPassword(password);
  const seedHex = `0x${Buffer.from(seed).toString("hex")}` as const;

  return { seed, seedHex };
};
