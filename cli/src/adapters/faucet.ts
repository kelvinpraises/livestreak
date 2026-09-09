// S9 — operator funding ergonomics. A fresh operator AA wallet holds 0 USDC, so `vault create`
// reverts opaquely (bare ExecutionFailed `0xacfdb444`). On a local stack we can mint test USDC: the
// deployed MockUSDC exposes a permissionless `mint(address,uint256)`. This adapter mints via the
// operator's own AA account (a userOp), mirroring the goLive/setEnded writer plumbing.

import { encodeFunctionData } from "viem";
import {
  pollUntilUserOperationIncluded,
  type WalletAccountEvmErc4337
} from "@livestreak/wallet";

/** USDC carries 6 decimals (MockUSDC.decimals() == 6). */
export const USDC_DECIMALS = 6;

/** Whole USDC → atomic units. */
export const usdcToAtomic = (whole: bigint): bigint => whole * 10n ** BigInt(USDC_DECIMALS);

const mockUsdcMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  }
] as const;

/** True for RPCs that point at a local dev chain — gate the test-USDC mint to these only. */
export const isLocalRpc = (rpcUrl: string): boolean =>
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/u.test(rpcUrl);

export interface MintMockUsdcInput {
  readonly account: WalletAccountEvmErc4337;
  readonly usdc: `0x${string}`;
  readonly to: `0x${string}`;
  /** Atomic USDC units to mint. */
  readonly amount: bigint;
}

/** Mint test USDC to `to` via the operator AA account; returns the userOp hash. */
export const mintMockUsdc = async (input: MintMockUsdcInput): Promise<string> => {
  const data = encodeFunctionData({
    abi: mockUsdcMintAbi,
    functionName: "mint",
    args: [input.to, input.amount]
  });

  const sendResult = await input.account.sendTransaction({
    to: input.usdc,
    data,
    value: 0n
  });

  const readOnly = await input.account.toReadOnlyAccount();
  await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
  return sendResult.hash;
};
