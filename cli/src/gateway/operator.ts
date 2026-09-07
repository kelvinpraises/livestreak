import { asUserAddress, type UserAddress } from "@livestreak/options";
import { createCreatorWallet } from "../adapters/onchain.js";
import { resolveOperator } from "./identity.js";
import { resolvePassword } from "./password.js";
import { defaultInitDocPath, loadInitDoc, type LivestreakInitDoc } from "../prefs/init-doc.js";
import type { WalletAccountEvmErc4337 } from "@livestreak/wallet";
import type { PublicClient } from "viem";
import type { WalletInit } from "@livestreak/schema";

export interface OperatorContext {
  readonly doc: LivestreakInitDoc;
  readonly seed: Uint8Array;
  readonly userAddress: UserAddress;
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly walletInit: WalletInit;
}

// #12 — the CLI is a KEYSTORE harness: authn (keystore/password → seed) lives here, but wallet
// construction + chain writes (authz) live in the packages, which build their OWN wallet from
// `{ seed, walletInit }` (exactly like the options/bookmaker bridges already do). This thin handle
// yields the decrypted seed + walletInit + doc WITHOUT constructing an AA `account` or an RPC client —
// edges that don't sign through the operator Safe (e.g. `steward resolve`, which signs as the steward
// EOA) take this instead of the full `OperatorContext`.
export interface KeystoreHandle {
  readonly doc: LivestreakInitDoc;
  readonly seed: Uint8Array;
  readonly walletInit: WalletInit;
}

export const resolveKeystore = async (input?: {
  readonly configPath?: string;
  readonly password?: string;
}): Promise<KeystoreHandle> => {
  const doc = await loadInitDoc(input?.configPath ?? defaultInitDocPath);
  const password = await resolvePassword(input?.password);
  const { seed } = resolveOperator(password);

  const walletInit: WalletInit = {
    chain: "evm",
    seedSource: "signature-derived",
    config: {
      ...doc.wallet.config,
      provider: doc.chain.rpc,
      chainId: doc.chain.chainId
    }
  };

  return { doc, seed, walletInit };
};

export const resolveOperatorContext = async (input?: {
  readonly configPath?: string;
  readonly password?: string;
}): Promise<OperatorContext> => {
  const doc = await loadInitDoc(input?.configPath ?? defaultInitDocPath);
  const password = await resolvePassword(input?.password);
  const { seed } = resolveOperator(password);

  const walletConfig = {
    ...doc.wallet.config,
    provider: doc.chain.rpc,
    chainId: doc.chain.chainId
  } as const;

  const { account, publicClient, walletInit } = await createCreatorWallet({
    seed,
    config: walletConfig
  });

  const userAddress = asUserAddress((await account.getAddress()) as `0x${string}`);

  return { doc, seed, userAddress, account, publicClient, walletInit };
};
