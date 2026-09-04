import { createCreatorWallet } from "../chains/evm.js";
import { resolveOperator } from "../gateway/identity.js";
import { defaultInitDocPath, loadInitDoc, type LivestreakInitDoc } from "../prefs/init-doc.js";
import { asUserAddress, type UserAddress } from "@livestreak/options";

const readPassword = (password: string | undefined): string => {
  const resolved = password ?? process.env["LIVESTREAK_PASSWORD"];
  if (resolved === undefined || resolved.length === 0) {
    throw new Error(
      "Operator password required: set LIVESTREAK_PASSWORD or pass --password"
    );
  }
  return resolved;
};

export interface OperatorContext {
  readonly doc: LivestreakInitDoc;
  readonly seed: Uint8Array;
  readonly userAddress: UserAddress;
  readonly account: Awaited<ReturnType<typeof createCreatorWallet>>["account"];
  readonly publicClient: Awaited<ReturnType<typeof createCreatorWallet>>["publicClient"];
  readonly walletInit: Awaited<ReturnType<typeof createCreatorWallet>>["walletInit"];
}

export const resolveOperatorContext = async (input?: {
  readonly configPath?: string;
  readonly password?: string;
}): Promise<OperatorContext> => {
  const doc = await loadInitDoc(input?.configPath ?? defaultInitDocPath);
  const { seed } = resolveOperator(readPassword(input?.password));
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
