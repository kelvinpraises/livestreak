import { createWalletManager } from "@livestreak/wallet";
import type { Hex } from "viem";

// --- exports ---

export interface EvmWalletContext {
  readonly seed: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly entryPoint: string;
  readonly bundlerUrl?: string;
}

export const resolveEvmExecutorPrivateKey = async (ctx: EvmWalletContext): Promise<Hex> => {
  const manager = createWalletManager("evm", ctx.seed, {
    chainId: ctx.chainId,
    provider: ctx.rpcUrl,
    bundlerUrl: ctx.bundlerUrl ?? "http://127.0.0.1:4337",
    entryPointAddress: ctx.entryPoint,
    safeModulesVersion: "0.3.0",
    useNativeCoins: true
  });
  const account = await manager.getAccount(0);
  const raw = account.keyPair.privateKey;
  if (raw === null) {
    throw new Error("evm_wallet_private_key_unavailable");
  }

  return (`0x${Buffer.from(raw).toString("hex")}`) as Hex;
};
